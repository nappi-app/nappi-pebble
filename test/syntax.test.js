// The SDK bundles src/pkjs with webpack 1, whose parser stops at anything
// newer than ES2015. Node accepts all of it, so unit tests alone would pass
// code that `pebble build` rejects. This is a cheap tripwire for the usual
// offenders; `pebble build` stays the authority.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'src', 'pkjs');

const FORBIDDEN = [
  [/,\s*\)/, 'trailing comma in call or parameter list'],
  [/\basync\b|\bawait\b/, 'async/await'],
  [/\{\s*\.\.\.\s*\w/, 'object spread'],
  [/\*\*(?!\/)/, 'exponent operator'],
  [/\?\./, 'optional chaining'],
  [/\?\?/, 'nullish coalescing'],
  [/catch\s*\{/, 'optional catch binding'],
];

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).forEach((file) => {
  test('src/pkjs/' + file + ' sticks to syntax the SDK bundler can parse', () => {
    const source = withoutComments(fs.readFileSync(path.join(DIR, file), 'utf8'));
    FORBIDDEN.forEach(([pattern, what]) => {
      assert.ok(!pattern.test(source), file + ' uses ' + what);
    });
  });
});
