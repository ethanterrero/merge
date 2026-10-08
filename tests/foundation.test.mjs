import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('mobile workspace has the expected entry point', () => {
  const pkg = JSON.parse(read('apps/mobile/package.json'));
  assert.equal(pkg.main, 'expo/AppEntry');
  assert.ok(pkg.scripts.typecheck);
  assert.ok(pkg.scripts.lint);
});

test('commuter tables enable row-level security', () => {
  const sql = read('supabase/migrations/0001_initial.sql');
  for (const table of ['profiles', 'vehicles', 'commutes', 'invitations']) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security;`, 'i'));
  }
});

test('discovery is opt-in by default', () => {
  assert.match(read('supabase/migrations/0001_initial.sql'), /discovery_opt_in boolean not null default false/i);
});

test('environment examples never contain real credentials', () => {
  const example = read('apps/mobile/.env.example');
  assert.match(example, /^EXPO_PUBLIC_SUPABASE_URL=\s*$/m);
  assert.match(example, /^EXPO_PUBLIC_SUPABASE_ANON_KEY=\s*$/m);
});
