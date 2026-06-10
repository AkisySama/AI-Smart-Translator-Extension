const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');
const contentJs = fs.readFileSync(path.join(rootDir, 'content', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(rootDir, 'content', 'content.css'), 'utf8');

test('word prompt asks AI for a composition components array', () => {
  assert.match(backgroundJs, /"components": 构词成分数组/);
  assert.match(backgroundJs, /"text"/);
  assert.match(backgroundJs, /"type"/);
  assert.match(backgroundJs, /"meaning"/);
  assert.match(backgroundJs, /前缀、词根、后缀、词干/);
});

test('background normalizes components with legacy root fallback', () => {
  assert.match(backgroundJs, /function normalizeWordComponents/);
  assert.match(backgroundJs, /const components = normalizeWordComponents\(parsed, legacyRoot\)/);
  assert.match(backgroundJs, /wordParts/);
  assert.match(backgroundJs, /morphemes/);
  assert.match(backgroundJs, /fallbackRoot/);
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
