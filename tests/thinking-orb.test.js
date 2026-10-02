const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function setup({ reduced = false, hidden = false, observer = false } = {}) {
  const callbacks = new Map();
  const documentListeners = new Map();
  const mediaListeners = new Map();
  const draws = [];
  let nextId = 0;
  let intersection;
  const media = { matches: reduced,
    addEventListener: (name, fn) => mediaListeners.set(name, fn),
    removeEventListener: name => mediaListeners.delete(name) };
  const document = { visibilityState: hidden ? 'hidden' : 'visible',
    addEventListener: (name, fn) => documentListeners.set(name, fn),
    removeEventListener: name => documentListeners.delete(name) };
  const context = vm.createContext({ window: { devicePixelRatio: 3, matchMedia: () => media },
    document, performance: { now: () => 1000 },
    requestAnimationFrame: fn => { callbacks.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: id => callbacks.delete(id),
    ...(observer ? { IntersectionObserver: class {
      constructor(fn) { intersection = fn; }
      observe() {}
      disconnect() { this.disconnected = true; }
    } } : {}) });
  vm.runInContext(read('lib/thinking-orbs/engine.js'), context);
  vm.runInContext(read('content/thinking-orb.js'), context);
  const canvas = { isConnected: true, style: {}, getContext: () => ({
    setTransform() {}, clearRect() {}, beginPath() {}, arc: (...dot) => draws.push(dot),
    fill() {}, moveTo() {}, lineTo() {}, stroke() {} }) };
  context.canvas = canvas;
  return { context, canvas, callbacks, document, documentListeners, media, mediaListeners, draws,
    mount: () => vm.runInContext('AIThinkingOrb.mount(canvas)', context),
    tick() {
      const [id, fn] = callbacks.entries().next().value;
      callbacks.delete(id);
      fn();
    },
    intersect: visible => intersection([{ isIntersecting: visible }]) };
}

test('manifest loads the local engine and adapter before the content script', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.deepEqual(manifest.content_scripts[0].js, [
    'lib/thinking-orbs/engine.js', 'content/thinking-orb.js', 'content/content.js'
  ]);
});

test('official engine produces finite dots for every state at both sizes', () => {
  const { context } = setup();
  const counts = vm.runInContext(`Object.keys(AIThinkingOrbEngine.STATE_TO_MODE).flatMap(state =>
    [20, 64].map(size => {
      const { mode, opts } = AIThinkingOrbEngine.resolvePreset(state, size);
      const frame = AIThinkingOrbEngine.MODE_FRAMES[mode](size, 0.6, opts);
      if (!frame.dots.every(dot => [dot.x, dot.y, dot.r, dot.white].every(Number.isFinite))) {
        throw new Error(state + ': invalid dots');
      }
      return frame.dots.length;
    }))`, context);
  assert.equal(counts.length, 18);
  assert.ok(counts.every(count => count > 0));
});

test('animation paints, caps pixel density, and releases callbacks on disposal', () => {
  const env = setup();
  const dispose = env.mount();
  assert.equal(env.canvas.width, 128);
  assert.equal(env.canvas.style.width, '64px');
  assert.ok(env.draws.length > 0);
  assert.equal(env.callbacks.size, 1);
  env.tick();
  assert.equal(env.callbacks.size, 1);
  dispose();
  dispose();
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.documentListeners.size, 0);
  assert.equal(env.mediaListeners.size, 0);
});

test('hidden tabs and offscreen canvases pause, then resume one animation loop', () => {
  const env = setup({ hidden: true, observer: true });
  const dispose = env.mount();
  assert.equal(env.callbacks.size, 0);
  env.document.visibilityState = 'visible';
  env.documentListeners.get('visibilitychange')();
  assert.equal(env.callbacks.size, 1);
  env.intersect(false);
  assert.equal(env.callbacks.size, 0);
  env.intersect(true);
  assert.equal(env.callbacks.size, 1);
  env.document.visibilityState = 'hidden';
  env.documentListeners.get('visibilitychange')();
  assert.equal(env.callbacks.size, 0);
  dispose();
  env.intersect(true);
  assert.equal(env.callbacks.size, 0);
});

test('reduced motion paints a static frame and follows live preference changes', () => {
  const env = setup({ reduced: true });
  const dispose = env.mount();
  assert.ok(env.draws.length > 0);
  assert.equal(env.callbacks.size, 0);
  env.media.matches = false;
  env.mediaListeners.get('change')();
  assert.equal(env.callbacks.size, 1);
  env.media.matches = true;
  env.mediaListeners.get('change')();
  assert.equal(env.callbacks.size, 0);
  dispose();
});

test('detached canvas stops animating and removes listeners', () => {
  const env = setup();
  env.mount();
  env.canvas.isConnected = false;
  env.tick();
  assert.equal(env.callbacks.size, 0);
  assert.equal(env.documentListeners.size, 0);
  assert.equal(env.mediaListeners.size, 0);
});

test('unavailable canvas rendering falls back without starting an animation', () => {
  const env = setup();
  env.canvas.getContext = () => null;
  const dispose = env.mount();
  assert.equal(env.canvas.hidden, true);
  assert.equal(env.callbacks.size, 0);
  dispose();
});
