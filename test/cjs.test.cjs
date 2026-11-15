const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SafeRegExp } = require('../dist/cjs/index.js');

test('CommonJS build loads and matches', () => {
  assert.equal(new SafeRegExp('a(b+)').exec('xabb')[1], 'bb');
});
