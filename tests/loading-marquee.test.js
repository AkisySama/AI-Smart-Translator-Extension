const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const contentJs = fs.readFileSync(path.join(rootDir, 'content', 'content.js'), 'utf8');
const contentCss = fs.readFileSync(path.join(rootDir, 'content', 'content.css'), 'utf8');

test('loading popup gets a dedicated marquee class', () => {
  assert.match(contentJs, /ai-translator-popup--loading/);
  assert.match(contentJs, /classList\.remove\('ai-translator-popup--loading'\)/);
});

test('loading marquee draws an animated rainbow border around the popup', () => {
  assert.match(contentCss, /\.ai-translator-popup--loading::before/);
  assert.match(contentCss, /conic-gradient/);
  assert.match(contentCss, /animation:\s*ai-rainbow-marquee/);
  assert.match(contentCss, /@keyframes ai-rainbow-marquee/);
});

test('loading popup does not render the old circular spinner', () => {
  assert.doesNotMatch(contentJs, /class="spinner"/);
  assert.doesNotMatch(contentCss, /\.ai-translator-loading \.spinner/);
  assert.doesNotMatch(contentCss, /@keyframes ai-spin/);
});
