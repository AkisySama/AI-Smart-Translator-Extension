const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function background(getAiResponse, settings = {apiKey: 'test-key'}) {
  const context = vm.createContext({ getAiResponse, chrome: {
    storage: {local: {get: async () => settings}},
    runtime: {
      onMessage: {addListener(fn) { context.receive = fn; }},
      onConnect: {addListener(fn) { context.connect = fn; }},
    }
  } });
  vm.runInContext(read('background.js').replace(/^import .*\n/, ''), context);
  return context;
}
const context = background();
const wordResponse = {meaning: '测试', pos: '名词', components: [{text: 'test'}], composition: '完整词干'};

test('API combines split SSE chunks and reports deltas immediately', async (t) => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(read('lib/ai-providers.js')).toString('base64')}`;
  const { getAiResponse } = await import(moduleUrl);
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"first\\n"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"second"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const deltas = [];

  t.mock.method(global, 'fetch', async () => new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  ));

  const result = await getAiResponse('', 'key', 'model', 'prompt', 'word', (delta) => {
    deltas.push(delta);
  });
  assert.equal(result, 'first\nsecond');
  assert.deepEqual(deltas, ['first\n', 'second']);
});

test('NDJSON fields become available only when a JSON object completes', () => {
  const updates = [];
  const accumulator = context.createStreamAccumulator(true, data => updates.push(data));
  accumulator.push('{"field":"meaning","value":"测试释义"}\n{"field":"pos","val');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].meaning, '测试释义');
  assert.equal(updates[0].pos, '');
  accumulator.push('ue":"noun"}\n');
  assert.equal(updates.length, 2);
  assert.equal(updates[1].pos, '名词');
});

test('failed parsing is never cached and the next lookup reaches the API', async () => {
  for (const invalid of ['不是 JSON', '{"field":"meaning","value":"测试"}\nnot JSON', 'null']) {
    let calls = 0;
    const app = background(async (...args) => {
      const raw = ++calls === 1 ? invalid : JSON.stringify(wordResponse);
      args[5](raw);
      return raw;
    });
    await assert.rejects(app.handleTranslation('test', true));
    assert.equal(vm.runInContext('translationCache.size', app), 0);
    assert.equal((await app.handleTranslation('test', true)).meaning, '测试');
    await app.handleTranslation('test', true);
    assert.equal(calls, 2);
  }
});

test('formatted NDJSON, fenced JSON and mixed response formats recover complete words', async () => {
  const events = Object.entries(wordResponse).map(([field, value]) => JSON.stringify({field, value}, null, 2));
  for (const raw of [events.join('\n'), events.join(''), '```json\n' + JSON.stringify(wordResponse, null, 2) + '\n```',
    events[0] + '\n模型改用完整对象：\n' + JSON.stringify(wordResponse)]) {
    const app = background(async (...args) => {
      for (let i = 0; i < raw.length; i += 7) args[5](raw.slice(i, i + 7));
      return raw;
    });
    const result = await app.handleTranslation('test', true);
    assert.equal(result.composition, wordResponse.composition);
    assert.equal(result.components[0].text, 'test');
  }
});

test('retry bypasses cached results on both message routes and settings isolate caches', async () => {
  let calls = 0;
  let raw = JSON.stringify(wordResponse);
  const settings = {apiKey: 'test-key', apiUrl: 'https://example.invalid', modelName: 'model-a'};
  const app = background(async (...args) => { calls++; args[5](raw); return raw; }, settings);
  await app.handleTranslation('test', true);
  raw = '不是 JSON';
  const failed = await new Promise(resolve => app.receive({action: 'translate', text: 'test', isWord: true, forceRefresh: true}, {}, resolve));
  assert.ok(failed.error);
  assert.equal(vm.runInContext('translationCache.size', app), 0);
  raw = JSON.stringify(wordResponse);
  await app.handleTranslation('test', true);
  const result = await new Promise(resolve => {
    const port = {name: 'translation-stream', postMessage: message => { if (message.type !== 'progress') resolve(message); },
      onMessage: {addListener(fn) { port.send = fn; }}};
    app.connect(port);
    port.send({action: 'translate', text: 'test', isWord: true, forceRefresh: true});
  });
  assert.equal(result.type, 'result');
  assert.equal(calls, 4);
  for (const key of ['modelName', 'apiUrl', 'apiKey']) {
    settings[key] += '-new';
    await app.handleTranslation('test', true);
  }
  assert.equal(calls, 7);
});

test('sentence responses accept plain text, legacy NDJSON and truncated JSON', () => {
  for (const input of [
    '自然中文译文。',
    '{"field":"translation","value":"自然中文译文。"}',
    '{"field":"translation","value":"自然中文译文。',
  ]) {
    const result = context.normalizeAiResponse(input, false);
    assert.equal(result.type, 'sentence');
    assert.equal(result.translation, '自然中文译文。');
  }
});

test('word components retain whole-word and legacy-root fallbacks', () => {
  const word = { meaning: '韵律', pos: '名词', components: [], composition: '完整词干' };
  for (const [extra, text, type] of [[{}, 'rhythm', '词干'], [{root: 'rhythm'}, 'rhythm', '词根']]) {
    const result = context.normalizeAiResponse({...word, ...extra}, true, 'rhythm');
    assert.equal(result.components.length, 1);
    assert.equal(result.components[0].text, text);
    assert.equal(result.components[0].type, type);
  }
});

test('word components accept objects and plus-separated strings', () => {
  for (const [input, expected] of [
    [{ text: 'spect', type: '词根', meaning: '看' }, ['spect']],
    ['un- + happy + -ness', ['un-', 'happy', '-ness']],
  ]) {
    assert.deepEqual(Array.from(context.normalizeWordComponentValue(input), item => item.text), expected);
  }
});

test('English part-of-speech names and abbreviations normalize to Chinese', () => {
  for (const [name, abbreviation, expected] of [
    ['noun', 'n.', '名词'], ['verb', 'v.', '动词'],
    ['adjective', 'adj.', '形容词'], ['adverb', 'adv.', '副词'],
    ['pronoun', 'pron.', '代词'], ['preposition', 'prep.', '介词'],
    ['conjunction', 'conj.', '连词'], ['interjection', 'interj.', '感叹词'],
  ]) for (const input of [name, abbreviation, name.toUpperCase(), expected]) {
    assert.equal(context.normalizeChinesePartOfSpeech(input), expected);
  }
});

test('related words excludes original, duplicates and malformed entries and caps at five', () => {
  const entries = ['program', 'diagram', 'DIAGRAM', 'telegram', 'anagram', 'monogram', 'epigram', 'histogram', '<script>'];
  const result = context.normalizeRelatedWords({ words: entries.map(word => ({ word, meaning: '含义', relation: '同源关系' })) }, 'program');
  assert.deepEqual(Array.from(result.words, item => item.word), ['diagram', 'telegram', 'anagram', 'monogram', 'epigram']);
  assert.throws(() => context.normalizeRelatedWords({words: [{word: 'telegram'}]}, 'program'));
  assert.throws(() => context.normalizeRelatedWords({}, 'program'));
});
