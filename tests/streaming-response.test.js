const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const providerJs = fs.readFileSync(path.join(rootDir, 'lib', 'ai-providers.js'), 'utf8');
const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(rootDir, 'content', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(rootDir, 'content', 'content.css'), 'utf8');

test('API requests and parses an SSE stream', () => {
  assert.match(providerJs, /stream:\s*true/);
  assert.match(providerJs, /text\/event-stream/);
  assert.match(providerJs, /getReader\(\)/);
  assert.match(providerJs, /choices\?\.\[0\]\?\.delta\?\.content/);
});

test('API combines split SSE chunks and reports deltas immediately', async () => {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(providerJs).toString('base64')}`;
  const { getAiResponse } = await import(moduleUrl);
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"choices":[{"delta":{"content":"first\\n"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"second"}}]}\n\n',
    'data: [DONE]\n\n',
  ];
  const originalFetch = global.fetch;
  const deltas = [];

  global.fetch = async () => new Response(
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

  try {
    const result = await getAiResponse('', 'key', 'model', 'prompt', 'word', (delta) => {
      deltas.push(delta);
    });
    assert.equal(result, 'first\nsecond');
    assert.deepEqual(deltas, ['first\n', 'second']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('background sends each complete NDJSON field as progress', () => {
  assert.match(backgroundJs, /translation-stream/);
  assert.match(backgroundJs, /createStreamAccumulator/);
  assert.match(backgroundJs, /type: "progress"/);
});

test('background exposes fields as soon as each NDJSON line completes', () => {
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
      },
    },
  });
  vm.runInContext(backgroundJs.replace(/^import .*\n/, ''), context);
  const createAccumulator = vm.runInContext('createStreamAccumulator', context);
  const updates = [];
  const accumulator = createAccumulator(true, (data) => {
    updates.push(JSON.parse(JSON.stringify(data)));
  });

  accumulator.push('{"field":"meaning","value":"测试释义"}\n{"field":"pos","val');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].meaning, '测试释义');
  assert.equal(updates[0].pos, '');

  accumulator.push('ue":"noun"}\n');
  assert.equal(updates.length, 2);
  assert.equal(updates[1].pos, '名词');
});

test('sentence translation accepts plain text without requiring JSON', () => {
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
      },
    },
  });
  vm.runInContext(backgroundJs.replace(/^import .*\n/, ''), context);
  const normalize = vm.runInContext('normalizeAiResponse', context);

  const result = normalize('这是一个较长句子的自然中文翻译。', false);
  assert.equal(result.type, 'sentence');
  assert.equal(result.translation, '这是一个较长句子的自然中文翻译。');
});

test('sentence translation remains compatible with legacy NDJSON', () => {
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
      },
    },
  });
  vm.runInContext(backgroundJs.replace(/^import .*\n/, ''), context);
  const normalize = vm.runInContext('normalizeAiResponse', context);

  const result = normalize('{"field":"translation","value":"兼容旧格式。"}', false);
  assert.equal(result.translation, '兼容旧格式。');
});

test('sentence translation salvages a value from a truncated JSON wrapper', () => {
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
      },
    },
  });
  vm.runInContext(backgroundJs.replace(/^import .*\n/, ''), context);
  const normalize = vm.runInContext('normalizeAiResponse', context);

  const result = normalize('{"field":"translation","value":"即使包装 JSON 没有正常闭合，也能显示已经返回的长句译文', false);
  assert.equal(result.translation, '即使包装 JSON 没有正常闭合，也能显示已经返回的长句译文');
});

test('content script renders both progress and final port messages', () => {
  assert.match(contentJs, /function connectTranslationStream/);
  assert.match(contentJs, /runtime\.connect/);
  assert.match(contentJs, /message\.type === 'result'/);
  assert.match(contentJs, /renderWordPopup\(message\.data/);
});

test('streamed fields use a sequential typewriter queue', () => {
  assert.match(contentJs, /function queueTypewriter/);
  assert.match(contentJs, /typewriterQueue = typewriterQueue\.then/);
  assert.match(contentJs, /setTimeout\(typeNext, speed\)/);
  assert.match(contentCss, /\.ai-typewriter-active::after/);
});

test('word popup reserves a stable layout while fields arrive', () => {
  assert.match(contentJs, /function createWordPopupView/);
  assert.match(contentJs, /ai-stream-pending/);
  assert.match(contentCss, /width:\s*320px/);
  assert.match(contentCss, /\.ai-translator-popup--word:not\(\.ai-translator-popup--loading\)/);
  assert.match(contentCss, /\.ai-translator-popup--loading\s*\{[^}]*width:\s*max-content/s);
  assert.match(contentCss, /\.ai-stream-pending/);
});
