const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {};
    this.className = ''; this.textContent = '';
    this.classList = {
      add: (...names) => { this.className += ' ' + names.join(' '); },
      remove: (...names) => { this.className = this.className.split(' ').filter(x => !names.includes(x)).join(' '); },
      toggle: (name, on) => on ? this.classList.add(name) : this.classList.remove(name)
    };
  }
  get isConnected() { return this.tagName === 'body' || !!this.parent?.isConnected; }
  append(...items) { items.forEach(item => this.appendChild(item)); }
  appendChild(item) { item.parent = this; this.children.push(item); return item; }
  replaceChildren(...items) { this.children.forEach(item => item.parent = null); this.children = []; this.append(...items); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); this.parent = null; }
  contains(target) { return this === target || this.children.some(child => child.contains(target)); }
  matches(selector) { return this.className.split(' ').includes(selector.slice(1)); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return {left: 20, top: 20, right: 340, bottom: 320, width: 320, height: 300}; }
}

function textarea(value, start, end) {
  const field = new Element('TEXTAREA');
  Object.assign(field, {value, selectionStart: start, selectionEnd: end, events: [],
    focus() {}, dispatchEvent(event) { this.events.push(event); },
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; },
    setRangeText(text, s, e) { this.value = this.value.slice(0, s) + text + this.value.slice(e); }});
  return field;
}

function content({execCommand = () => false} = {}) {
  const body = new Element('body');
  const messages = [];
  const document = {body, activeElement: null, execCommand,
    addEventListener() {}, removeEventListener() {}, createElement: tag => new Element(tag)};
  const context = vm.createContext({document, setTimeout,
    InputEvent: class { constructor(type, init) { Object.assign(this, {type}, init); } },
    window: {innerHeight: 800, innerWidth: 1000, scrollX: 0, scrollY: 0, matchMedia: () => ({matches: true}),
      getSelection: () => ({toString: () => ''})},
    chrome: {runtime: {sendMessage(request, callback) { messages.push({request, callback}); }}}});
  vm.runInContext(read('content/content.js'), context);
  return {context, document, body, messages};
}

test('selected Chinese in a text field is detected and replaced via the undo-friendly fallback', () => {
  const {context, document, body, messages} = content();
  const field = textarea('请 帮我写一封邮件 ok', 1, 10);
  body.appendChild(field);
  document.activeElement = field;

  const target = context.getEditableSelection();
  assert.equal(target.text, ' 帮我写一封邮件 ');
  assert.equal(context.isChineseForEnglish(target.text), true);
  assert.equal(context.isChineseForEnglish('plain English'), false);

  context.requestEnglishTranslation(target, 10, 10);
  assert.equal(messages[0].request.action, 'translateToEnglish');
  assert.equal(messages[0].request.text, '帮我写一封邮件');
  const loading = body.querySelector('.ai-translator-popup');
  messages[0].callback({data: {type: 'sentence', translation: 'Help me write an email'}});

  assert.equal(field.value, '请 Help me write an email ok');
  assert.equal(field.events[0].type, 'input');
  assert.equal(loading.isConnected, false);
});

test('insertText is preferred when the browser supports it', () => {
  const calls = [];
  const {context, document, body} = content({execCommand: (...args) => { calls.push(args); return true; }});
  const field = textarea('你好', 0, 2);
  body.appendChild(field);
  document.activeElement = field;
  assert.equal(context.replaceEditableSelection(context.getEditableSelection(), 'Hello'), true);
  assert.deepEqual(calls, [['insertText', false, 'Hello']]);
  assert.equal(field.events.length, 0);
});

test('a field edited while translating is left alone and the translation is shown instead', async () => {
  const {context, document, body, messages} = content();
  const field = textarea('你好世界', 0, 4);
  body.appendChild(field);
  document.activeElement = field;
  context.requestEnglishTranslation(context.getEditableSelection(), 10, 10);
  field.value = '你好，世界';
  messages[0].callback({data: {type: 'sentence', translation: 'Hello world'}});
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(field.value, '你好，世界');
  const popup = body.querySelector('.ai-translator-popup');
  assert.equal(popup.querySelector('.ai-val').textContent, 'Hello world');
});

test('errors keep the popup open with a retry that bypasses the cache', () => {
  const {context, document, body, messages} = content();
  const field = textarea('你好', 0, 2);
  body.appendChild(field);
  document.activeElement = field;
  context.requestEnglishTranslation(context.getEditableSelection(), 10, 10);
  messages[0].callback({error: '鉴权失败'});
  const popup = body.querySelector('.ai-translator-popup');
  assert.equal(popup.querySelector('.ai-error').textContent, '鉴权失败');
  popup.querySelector('.ai-related-word').listeners.click();
  assert.equal(messages[1].request.forceRefresh, true);
});

test('password fields and collapsed selections are ignored', () => {
  const {context, document, body} = content();
  const field = textarea('你好', 1, 1);
  body.appendChild(field);
  document.activeElement = field;
  assert.equal(context.getEditableSelection(), null);
  const password = Object.assign(textarea('密码', 0, 2), {tagName: 'INPUT', type: 'password'});
  document.activeElement = password;
  assert.equal(context.getEditableSelection(), null);
});
