const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const contentJs = fs.readFileSync(path.join(rootDir, 'content', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(rootDir, 'content', 'content.css'), 'utf8');

function cssRuleBody(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = contentCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));
  return match ? match[1] : '';
}

test('word popup renders a focused learning card hierarchy', () => {
  assert.match(contentJs, /ai-word-meaning/);
  assert.match(contentJs, /ai-pos-tag/);
  assert.match(contentJs, /ai-component-block/);
  assert.match(contentJs, /ai-component-heading/);
  assert.match(contentJs, /ai-component-list/);
  assert.match(contentJs, /ai-component-origin/);
});

test('word card styles make meaning primary and composition label compact', () => {
  assert.match(contentCss, /\.ai-word-meaning/);
  assert.match(contentCss, /\.ai-pos-tag/);
  assert.match(contentCss, /\.ai-component-block/);
  assert.match(contentCss, /\.ai-component-heading/);

  const componentHeading = cssRuleBody('.ai-component-heading');
  assert.match(componentHeading, /display:\s*flex/);
  assert.match(componentHeading, /gap:\s*10px/);
  assert.doesNotMatch(componentHeading, /justify-content:\s*space-between/);
});
