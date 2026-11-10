import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('web má bezpečnostní hlavičky a proxy relace', async () => {
  const config = await readFile(new URL('../next.config.ts', import.meta.url), 'utf8');
  const proxy = await readFile(new URL('../src/proxy.ts', import.meta.url), 'utf8');
  assert.match(config, /X-Content-Type-Options/);
  assert.match(config, /X-Frame-Options/);
  assert.match(proxy, /getUser/);
  assert.match(proxy, /startsWith/);
});
