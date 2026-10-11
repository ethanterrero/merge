import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AuthStatus } from '../authRules';
import { dataMode, dataScope } from './mode';

test('dataMode: only prototype is mock and only ready is supabase', () => {
  const expected: Record<AuthStatus, string> = {
    prototype: 'mock',
    ready: 'supabase',
    loading: 'off',
    signedOut: 'off',
    needsProfile: 'off',
  };
  for (const [status, mode] of Object.entries(expected)) {
    assert.equal(dataMode(status as AuthStatus), mode, status);
  }
});

test('dataScope: mock is one shared scope, supabase is per user, off has none', () => {
  assert.equal(dataScope('mock', null), 'mock');
  assert.equal(dataScope('mock', 'u1'), 'mock');
  assert.equal(dataScope('supabase', 'u1'), 'sb:u1');
  assert.equal(dataScope('supabase', null), null);
  assert.equal(dataScope('off', 'u1'), null);
});
