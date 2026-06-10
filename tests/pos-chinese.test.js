const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');

test('word prompt requires Chinese part-of-speech names', () => {
  assert.match(backgroundJs, /"pos": 必须使用中文词性名称/);
  assert.match(backgroundJs, /不要返回英文词性、英文缩写或英文标签/);
  assert.match(backgroundJs, /例如：名词、动词、形容词、副词、介词、连词、代词/);
});

test('word response normalizes common English part-of-speech values to Chinese', () => {
  assert.match(backgroundJs, /function normalizeChinesePartOfSpeech/);
  assert.match(backgroundJs, /pos:\s*normalizeChinesePartOfSpeech\(/);
  assert.match(backgroundJs, /verb:\s*["']动词["']/);
  assert.match(backgroundJs, /noun:\s*["']名词["']/);
  assert.match(backgroundJs, /adjective:\s*["']形容词["']/);
  assert.match(backgroundJs, /adverb:\s*["']副词["']/);
});
