const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(rootDir, 'content', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(rootDir, 'content', 'content.css'), 'utf8');

test('word prompt asks AI for a composition components array', () => {
  assert.match(backgroundJs, /"field":"components"/);
  assert.match(backgroundJs, /"text":"构词成分或原形"/);
  assert.match(backgroundJs, /"type":"前缀\/词根\/后缀\/词干"/);
  assert.match(backgroundJs, /"meaning":"不超过12字的中文含义"/);
  assert.match(backgroundJs, /构词成分最多4个/);
});

test('word prompt emits important fields before the composition explanation', () => {
  const meaningIndex = backgroundJs.indexOf('{"field":"meaning"');
  const posIndex = backgroundJs.indexOf('{"field":"pos"');
  const componentsIndex = backgroundJs.indexOf('{"field":"components"');
  const compositionIndex = backgroundJs.indexOf('{"field":"composition"');

  assert.ok(meaningIndex < posIndex);
  assert.ok(posIndex < componentsIndex);
  assert.ok(componentsIndex < compositionIndex);
  assert.match(backgroundJs, /不超过70字/);
  assert.match(backgroundJs, /只解释构词关系，不展开历史演变/);
});

test('background normalizes components with legacy root fallback', () => {
  assert.match(backgroundJs, /function normalizeWordComponents/);
  assert.match(
    backgroundJs,
    /const components = normalizeWordComponents\(parsed, legacyRoot, fallbackWord\)/,
  );
  assert.match(backgroundJs, /wordParts/);
  assert.match(backgroundJs, /morphemes/);
  assert.match(backgroundJs, /fallbackRoot/);
});

function loadBackgroundFunction(name) {
  const context = vm.createContext({
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        onConnect: { addListener() {} },
      },
    },
  });
  vm.runInContext(backgroundJs.replace(/^import .*\n/, ''), context);
  return vm.runInContext(name, context);
}

test('an indivisible word falls back to the selected word as one stem', () => {
  const normalize = loadBackgroundFunction('normalizeAiResponse');
  const result = normalize({
    meaning: '韵律；节奏',
    pos: '名词',
    components: [],
    composition: '该词不宜进一步强行拆分。',
  }, true, 'rhythm');

  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].text, 'rhythm');
  assert.equal(result.components[0].type, '词干');
});

test('word components accept a single object or a string representation', () => {
  const normalizeComponents = loadBackgroundFunction('normalizeWordComponentValue');

  const objectResult = normalizeComponents({ text: 'spect', type: '词根', meaning: '看' });
  assert.equal(objectResult.length, 1);
  assert.equal(objectResult[0].text, 'spect');

  const stringResult = normalizeComponents('un- + happy + -ness');
  assert.deepEqual(
    Array.from(stringResult, (component) => component.text),
    ['un-', 'happy', '-ness'],
  );
});

test('word card renders composition chips instead of one root value', () => {
  assert.match(contentJs, /ai-component-block/);
  assert.match(contentJs, /ai-component-list/);
  assert.match(contentJs, /ai-component-chip/);
  assert.match(contentJs, /component\.text/);
  assert.match(contentJs, /rootLabel\.textContent = '构词'/);

  assert.match(contentCss, /\.ai-component-list/);
  assert.match(contentCss, /\.ai-component-chip/);
});
