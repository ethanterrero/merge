// Supabase safety reports backend. Pure: the client is injected, and only types are
// imported from supabase-js, so this loads under Node.
//
// insert() without .select() sends `Prefer: return=minimal`, so PostgREST runs no
// RETURNING: reporters have no select grant on safety_reports (0005), and a
// returning insert would fail. If hosted PostgREST ever rejects this, the fallback is
// a security definer RPC returning void, never a select policy.

import { settle, type ErrorOverrides } from './errors';
import { checkNewReport, REPORT_SEND_ERROR, type NewReport, type ReportsApi } from './reports.api';
import { toReportInsert } from './reports.map';
import type { Result, TypedClient } from './types';

// Offline and an ended session keep their own copy; everything else reads the same,
// so nothing tells a reporter whether the other person exists, blocked them or left.
const SEND_FAILED = { message: REPORT_SEND_ERROR };
const OVERRIDES: ErrorOverrides = {
  notAllowed: SEND_FAILED,
  conflict: SEND_FAILED,
  invalid: SEND_FAILED,
  server: SEND_FAILED,
  unknown: SEND_FAILED,
};

export function createReportsSupabase(client: TypedClient, userId: string) {
  return {
    submitReport: (report: NewReport): Promise<Result<null>> => {
      const invalid = checkNewReport(report, userId);
      if (invalid) return Promise.resolve({ ok: false, error: invalid });
      return settle(client.from('safety_reports').insert(toReportInsert(report, userId)), () => null, OVERRIDES);
    },
  } satisfies ReportsApi;
}
