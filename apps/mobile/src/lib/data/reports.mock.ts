// In-memory safety reports backend for prototype mode. Pure.
// Like the database, it accepts reports and gives nothing back: there is no read
// method. Prototype reports go nowhere.

import { mockResult, type MockOptions } from './mockUtil';
import { PROTOTYPE_MEMBER_ID } from './profile.mock';
import { checkNewReport, type NewReport, type ReportsApi } from './reports.api';
import type { Result } from './types';

export type ReportsMockOptions = MockOptions & {
  meId?: string;
  /** Test hook: receives each accepted report. Not a read-back path; the app never sets it. */
  onSubmit?: (report: NewReport) => void;
};

export function createReportsMock(options: ReportsMockOptions = {}) {
  const meId = options.meId ?? PROTOTYPE_MEMBER_ID;
  return {
    submitReport: async (report: NewReport): Promise<Result<null>> => {
      const invalid = checkNewReport(report, meId);
      if (invalid) return { ok: false, error: invalid };
      const result = await mockResult('submitReport', options, () => null);
      if (result.ok) options.onSubmit?.({ ...report });
      return result;
    },
  } satisfies ReportsApi;
}
