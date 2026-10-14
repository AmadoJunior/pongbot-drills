import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const listed = new Set([...readFileSync(join(root, 'sw.js'), 'utf8').match(/const APP_FILES = \[([\s\S]*?)\];/)[1]
  .matchAll(/'([^']+)'/g)].map(m => m[1]));

function walk(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [relative(root, p).split(sep).join('/')];
  });
}

test('service worker caches every app file', () => {
  const files = ['index.html', 'manifest.webmanifest', ...['css', 'js', 'assets'].flatMap(d => walk(join(root, d)))];
  for (const f of files) assert.ok(listed.has(f), `${f} is missing from APP_FILES in sw.js`);
  for (const f of listed) assert.ok(f === './' || existsSync(join(root, f)), `${f} in APP_FILES does not exist`);
});

test('manifest icons exist', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.ok(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
  for (const i of m.icons) assert.ok(existsSync(join(root, i.src)), i.src);
});
