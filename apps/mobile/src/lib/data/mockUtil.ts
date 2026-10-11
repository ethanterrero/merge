// Pure helpers for mock backends. Mock backends wrap src/data/mock.ts (or a
// feature's own mock file) read-only, and keep their writes in memory.

import type { DataError, Result } from './types';

/** Raise locally to see loading states on the web build. Keep 0 in commits. */
export const MOCK_LATENCY_MS: number = 0;

export type MockOptions = {
  /** Test hook: return an error to make the named method fail. */
  fail?: (method: string) => DataError | null;
};

/** null for an unknown id. Never falls back to the first item (unlike findMatch / findRequest). */
export function findById<T extends { id: string }>(items: readonly T[], id: string): T | null {
  return items.find((item) => item.id === id) ?? null;
}

/** Resolve like a backend call: asynchronously, as a Result, honoring `fail`. */
export async function mockResult<T>(method: string, options: MockOptions, produce: () => T): Promise<Result<T>> {
  if (MOCK_LATENCY_MS > 0) await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  else await Promise.resolve();
  const error = options.fail?.(method) ?? null;
  return error ? { ok: false, error } : { ok: true, data: produce() };
}
