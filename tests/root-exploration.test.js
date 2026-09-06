const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function background() {
  const context = vm.createContext({ chrome: { runtime: {
    onMessage: { addListener() {} }, onConnect: { addListener() {} }
  } } });
  vm.runInContext(read('background.js').replace(/^import .*\n/, ''), context);
  return context;
}

test('related words excludes original, duplicates and malformed entries and caps at five', () => {
  const context = background();
  const entries = ['program', 'diagram', 'DIAGRAM', 'telegram', 'anagram', 'monogram', 'epigram', 'histogram', '<script>'];
  const result = context.normalizeRelatedWords({ words: entries.map(word => ({ word, meaning: '含义', relation: '同源关系' })) }, 'program');
  assert.deepEqual(Array.from(result.words, item => item.word), ['diagram', 'telegram', 'anagram', 'monogram', 'epigram']);
  assert.throws(() => context.normalizeRelatedWords({words: [{word: 'telegram'}]}, 'program'));
  assert.throws(() => context.normalizeRelatedWords({}, 'program'));
});

class Element {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {};
    this.className = ''; this.textContent = ''; this.scrollHeight = 600;
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
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  setAttribute(name, value) { this[name] = value; }
  getBoundingClientRect() { return {left: 20, top: 20, right: 340, bottom: 320, width: 320, height: 300}; }
}
function content() {
  const ports = [];
  const body = new Element('body');
  const context = vm.createContext({ document: {body, addEventListener() {}, removeEventListener() {}, createElement: tag => new Element(tag)},
    window: {innerHeight: 800, innerWidth: 1000, scrollX: 0, scrollY: 0, matchMedia: () => ({matches: true})},
    setTimeout,
    chrome: {runtime: { connect() {
      const port = { onMessage: {addListener(fn) {port.receive = fn;}}, onDisconnect: {addListener(fn) {port.disconnected = fn;}},
        postMessage(request) {this.request = request;}, disconnect() {this.closed = true;} };
      ports.push(port); return port;
    } }}
  });
  vm.runInContext(read('content/content.js'), context);
  const owner = context.showPopup(20, 20, '', false, true);
  const view = context.createWordPopupView('program', owner);
  owner.appendChild(view.card);
  return {context, owner, view, ports};
}
const relatedData = {words: ['diagram', 'telegram', 'anagram', 'monogram', 'epigram'].map(word => ({word, meaning: '释义', relation: '同根'}))};

test('root and word clicks create separate windows without replacing earlier cards', async () => {
  const {context, owner, view, ports} = content();
  context.appendRelatedWords(view.card, 'program', {text: 'gram'});
  assert.equal(ports[0].request.action, 'relatedWords');
  ports[0].receive({type: 'result', data: relatedData});
  const listPopup = context.document.body.children[1];
  assert.equal(listPopup.dataset.placement, 'right');
  assert.equal(owner.children.length, 1);
  assert.equal(listPopup.querySelectorAll('.ai-related-word').length, 5);
  listPopup.querySelector('.ai-related-word').listeners.click({stopPropagation() {}});
  assert.equal(ports[1].request.text, 'diagram');
  ports[1].receive({type: 'result', data: {type: 'word', meaning: '图表', pos: '名词', components: [{text: 'gram'}], composition: '构词说明'}});
  await new Promise(resolve => setImmediate(resolve));
  const detailPopup = context.document.body.children[2];
  assert.equal(detailPopup.querySelectorAll('.ai-word-card').length, 1);
  assert.equal(owner.querySelectorAll('.ai-word-card').length, 1);
  assert.equal(listPopup.querySelectorAll('.ai-related-word').length, 5);
  assert.equal(owner.children[0], view.card);
  const chip = detailPopup.querySelector('.ai-component-chip');
  chip.listeners.click({stopPropagation() {}});
  assert.equal(ports[2].request.word, 'diagram');
  context.setPopupPinMode(owner, 'viewport');
  context.removeUnpinnedPopups();
  assert.equal(owner.isConnected, true);
  assert.equal(owner.querySelectorAll('.ai-pin-btn').every(button => button.dataset.pinMode === 'viewport'), true);
  context.setPopupPinMode(owner, 'none');
  context.removeUnpinnedPopups();
  assert.equal(owner.isConnected, false);
  assert.equal(ports[2].closed, true);
});

test('out-of-order related responses remain in their sections and errors can retry', () => {
  const {context, owner, view, ports} = content();
  context.appendRelatedWords(view.card, 'program', {text: 'pro-'});
  context.appendRelatedWords(view.card, 'program', {text: 'gram'});
  ports[1].receive({type: 'result', data: relatedData});
  ports[0].receive({type: 'error', error: '网络异常'});
  const sections = context.document.body.querySelectorAll('.ai-exploration-popup');
  assert.equal(sections[0].querySelector('.ai-error').textContent, '网络异常');
  assert.equal(sections[1].querySelectorAll('.ai-related-word').length, 5);
  sections[0].querySelector('.ai-related-word').listeners.click();
  assert.equal(ports[2].request.component.text, 'pro-');
  assert.equal(sections[1].querySelectorAll('.ai-related-word').length, 5);
});


test('related popup falls below when right side has no room, including page scroll', () => {
  const {context, owner, view} = content();
  context.window.innerWidth = 500;
  context.window.scrollY = 200;
  context.appendRelatedWords(view.card, 'program', {text: 'gram'});
  const popup = context.document.body.children[1];
  assert.equal(popup.dataset.placement, 'below');
  assert.equal(popup.style.top, '532px');
  assert.equal(popup.style.left, '20px');
  assert.equal(owner.children.length, 1);
});

test('close button dismisses only its popup even when pinned and disconnects its request', () => {
  const {context, owner, view, ports} = content();
  context.appendRelatedWords(view.card, 'program', {text: 'gram'});
  const popup = context.document.body.children[1];
  context.setPopupPinMode(popup, 'viewport');
  popup.querySelector('.ai-close-btn').listeners.click({preventDefault() {}, stopPropagation() {}});
  assert.equal(popup.isConnected, false);
  assert.equal(owner.isConnected, true);
  assert.equal(ports[0].closed, true);
  ports[0].receive({type: 'result', data: relatedData});
  assert.equal(context.document.body.children.length, 1);
});

test('placement avoids every existing card, prioritizing right then below', () => {
  const {context} = content();
  const anchor = {left: 20, top: 20, right: 340, bottom: 320};
  const size = {width: 320, height: 300};
  const viewport = {width: 1100, height: 800};
  const first = context.findPopupSpace(size, anchor, [anchor], viewport);
  assert.equal(first.placement, 'right');
  const right = {left: first.left, top: first.top, right: first.left + 320, bottom: first.top + 300};
  const second = context.findPopupSpace(size, anchor, [anchor, right], viewport);
  assert.equal(second.placement, 'below');
  const secondRect = {left: second.left, top: second.top, right: second.left + 320, bottom: second.top + 300};
  assert.equal(context.overlapsPopup(secondRect, right), false);
  assert.equal(context.overlapsPopup(secondRect, anchor), false);
});

test('crowded viewport extends downward without covering any older card', () => {
  const {context} = content();
  const occupied = [
    {left: 12, top: 12, right: 332, bottom: 312},
    {left: 12, top: 324, right: 332, bottom: 624},
  ];
  const next = context.findPopupSpace({width: 320, height: 300}, occupied[0], occupied, {width: 350, height: 640});
  assert.equal(next.top, 636);
  const rect = {left: next.left, top: next.top, right: next.left + 320, bottom: next.top + 300};
  assert.equal(occupied.some(old => context.overlapsPopup(rect, old)), false);
});

test('larger loaded card is placed using its full dimensions', () => {
  const {context} = content();
  const occupied = [
    {left: 20, top: 20, right: 340, bottom: 500},
    {left: 352, top: 20, right: 672, bottom: 320},
  ];
  const next = context.findPopupSpace({width: 320, height: 450}, occupied[0], occupied, {width: 700, height: 800});
  const rect = {left: next.left, top: next.top, right: next.left + 320, bottom: next.top + 450};
  assert.equal(occupied.some(old => context.overlapsPopup(rect, old)), false);
});
