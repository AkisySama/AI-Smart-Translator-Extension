const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const popupHtml = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
const popupCss = fs.readFileSync(path.join(rootDir, 'popup', 'popup.css'), 'utf8');
const popupJs = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');

test('settings popup has a polished connection-panel structure', () => {
  assert.match(popupHtml, /class="settings-header"/);
  assert.match(popupHtml, /class="app-title"/);
  assert.match(popupHtml, /配置你的 AI 接口/);
  assert.match(popupHtml, /class="settings-panel"/);
  assert.match(popupHtml, /class="settings-footer"/);
  assert.match(popupHtml, /本插件仅在本地保存配置，目前支持英文内容分析/);
  assert.match(popupHtml, /class="save-btn"/);
});

test('settings popup CSS defines refined panel, inputs, and save status styles', () => {
  assert.match(popupCss, /\.settings-header/);
  assert.match(popupCss, /\.settings-panel/);
  assert.match(popupCss, /\.provider-btns/);
  assert.match(popupCss, /input\[type="text"\]:focus/);
  assert.match(popupCss, /\.save-btn/);
  assert.match(popupCss, /\.status\.visible/);
});

test('save action toggles the visible status style', () => {
  assert.match(popupJs, /statusDiv\.classList\.add\("visible"\)/);
  assert.match(popupJs, /statusDiv\.classList\.remove\("visible"\)/);
  assert.match(popupJs, /statusDiv\.textContent = "设置已保存"/);
});
