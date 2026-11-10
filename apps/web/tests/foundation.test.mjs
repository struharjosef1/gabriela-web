import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

test('kanonická App Router cesta je src/app', async () => {
  await access(new URL('../src/app/dashboard/page.tsx', import.meta.url));
});

test('login nemá demonstrační bypass do dashboardu', async () => {
  const login = await readFile(new URL('../src/components/LoginForm.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(login, /if\s*\(!supabase\)\s*\{?\s*router\.push\(['"]\/dashboard/);
  assert.doesNotMatch(login, /Demonstrační režim/);
  assert.match(login, /signInWithPassword/);
});

test('dashboard načítá Supabase místo demo-data', async () => {
  const dashboard = await readFile(new URL('../src/app/dashboard/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dashboard, /demo-data/);
  assert.match(dashboard, /requireCurrentContext/);
});
