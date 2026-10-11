// Public entry for safety reports (binding file, M-24). Insert-only: there is no
// query hook, because no client can read a report back.

import { defineBackends, useDataMutation } from './backend';
import { reportsKeys, type NewReport, type ReportsApi } from './reports.api';
import { createReportsMock } from './reports.mock';
import { createReportsSupabase } from './reports.supabase';

const backends = defineBackends({ mock: createReportsMock(), supabase: createReportsSupabase });

const REPORT_ACTIONS = {
  submitReport: (api: ReportsApi, report: NewReport) => api.submitReport(report),
};

/** submitReport(report) resolves to a Result of null. A double tap sends once. */
export function useReportActions() {
  return useDataMutation(backends, REPORT_ACTIONS, { invalidate: reportsKeys.all });
}

export {
  EMERGENCY_LINE,
  MAX_REPORT_DETAILS,
  REPORT_CATEGORIES,
  REPORT_SENT_BODY,
  REPORT_SENT_TITLE,
  detailsLength,
  reportsKeys,
  validateReport,
} from './reports.api';
export type { NewReport, ReportCategory, ReportDraft, ReportsApi } from './reports.api';
