const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../popup/popup.js'), 'utf8');
function setup(fetch) {
  const elements = {};
  for (const id of ['providerBtns', 'apiUrl', 'apiKey', 'modelName', 'saveBtn', 'status', 'modelSelect', 'modelStatus', 'refreshModels']) {
    elements[id] = { value: '', classList: { add() {}, remove() {} }, handlers: {},
      addEventListener(event, fn) { this.handlers[event] = fn; }, querySelectorAll() { return []; }, focus() {},
      replaceChildren(...items) { this.options = items; }, add(item) { this.options.push(item); } };
  }
  let init, saved;
  const timers = new Map(); let next = 0;
  const context = vm.createContext({ URL, AbortController, TypeError, fetch,
    Option: function(text, value) { this.text = text; this.value = value; },
    setTimeout(fn) { timers.set(++next, fn); return next; }, clearTimeout(id) { timers.delete(id); },
    document: { addEventListener(_, fn) { init = fn; }, getElementById(id) { return elements[id]; } },
    chrome: { storage: { local: {
      get(_, cb) { cb({ provider: 'custom', providerSettings: { custom: { apiUrl: 'https://example.com/v1/chat/completions', apiKey: 'test-key', modelName: 'saved-model' } } }); },
      set(value, cb) { saved = value; cb(); }
    } } }
  });
  vm.runInContext(source, context); init();
  return { elements, context, saved: () => saved, run: () => { const [id, fn] = timers.entries().next().value; timers.delete(id); return fn(); } };
}
test('model endpoints preserve version and gateway prefixes', () => {
  const { context } = setup();
  for (const [input, expected] of [
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1/models'],
    ['https://api.deepseek.com/chat/completions', 'https://api.deepseek.com/models'],
    ['https://example.com/gateway/v1/', 'https://example.com/gateway/v1/models'],
    ['https://example.com/v1/models', 'https://example.com/v1/models']
  ]) assert.equal(context.modelsEndpoint(input), expected);
  assert.throws(() => context.modelsEndpoint('file:///tmp/key'));
});
test('loads saved custom settings, fetches unique models, and saves selection', async () => {
  let request;
  const app = setup(async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ data: [{ id: 'z' }, { id: 'a' }, { id: 'a' }, {}] }) }; });
  assert.equal(app.elements.modelName.value, 'saved-model');
  await app.run();
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.equal(app.elements.modelSelect.options.length, 3);
  app.elements.modelSelect.value = 'a'; app.elements.modelSelect.handlers.change();
  app.elements.saveBtn.handlers.click();
  assert.equal(app.saved().modelName, 'a');
});
test('authentication failure preserves manual model', async () => {
  const app = setup(async () => ({ ok: false, status: 401 }));
  await app.run();
  assert.match(app.elements.modelStatus.textContent, /鉴权失败/);
  assert.equal(app.elements.modelName.value, 'saved-model');
  assert.equal(app.elements.refreshModels.disabled, false);
});
test('editing credentials discards an older response', async () => {
  let resolve;
  const app = setup(() => new Promise(done => { resolve = done; }));
  const pending = app.run();
  app.elements.apiKey.value = 'new-key'; app.elements.apiKey.handlers.input();
  resolve({ ok: true, json: async () => ({ data: [{ id: 'old-model' }] }) });
  await pending;
  assert.equal(app.elements.modelSelect.disabled, true);
  assert.equal(app.elements.modelSelect.options.some(item => item.value === 'old-model'), false);
});
