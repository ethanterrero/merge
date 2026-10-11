// Pure data-mode selection. Mock data never renders when Supabase is configured:
// there's no fallback from 'supabase' to 'mock'.

import type { AuthStatus } from '../authRules';
import type { DataMode } from './types';

export function dataMode(status: AuthStatus): DataMode {
  if (status === 'prototype') return 'mock';
  if (status === 'ready') return 'supabase';
  return 'off';
}

/** Cache-key prefix, so entries from different users or modes are never read across. */
export function dataScope(mode: DataMode, userId: string | null): string | null {
  if (mode === 'mock') return 'mock';
  if (mode === 'supabase' && userId) return `sb:${userId}`;
  return null;
}
