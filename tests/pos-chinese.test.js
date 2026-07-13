const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rootDir = path.resolve(__dirname, '..');
const backgroundJs = fs.readFileSync(path.join(rootDir, 'background.js'), 'utf8');

test('word prompt requires Chinese part-of-speech names', () => {
  assert.match(backgroundJs, /"field":"pos"/);
  assert.match(backgroundJs, /中文词性/);
  assert.match(backgroundJs, /名词、动词、形容词/);
});

test('word response normalizes common English part-of-speech values to Chinese', () => {
  assert.match(backgroundJs, /function normalizeChinesePartOfSpeech/);
  assert.match(backgroundJs, /pos:\s*normalizeChinesePartOfSpeech\(/);
  assert.match(backgroundJs, /verb:\s*["']动词["']/);
  assert.match(backgroundJs, /noun:\s*["']名词["']/);
  assert.match(backgroundJs, /adjective:\s*["']形容词["']/);
  assert.match(backgroundJs, /adverb:\s*["']副词["']/);
});
