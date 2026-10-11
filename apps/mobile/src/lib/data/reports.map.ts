// UI -> row mapping for safety reports. Pure. There is no row -> UI mapper:
// reports are never read back.

import type { NewReport } from './reports.api';
import type { InsertRow } from './types';

/** Only the five columns clients may insert (0005 grants insert on these alone). */
export type ReportInsert = Pick<
  InsertRow<'safety_reports'>,
  'reporter_id' | 'reported_user_id' | 'ride_id' | 'category' | 'details'
>;

export function toReportInsert(report: NewReport, userId: string): ReportInsert {
  return {
    reporter_id: userId,
    reported_user_id: report.reportedUserId,
    ride_id: report.rideId,
    category: report.category,
    details: report.details,
  };
}
