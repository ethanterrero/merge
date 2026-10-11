// Safety reports (M-24): types, interface, validation and copy. Pure.
// Schema and rules: supabase/migrations/0005_blocks_reports.sql and
// docs/superpowers/specs/2026-10-08-blocks-reports-design.md.
//
// Reports are insert-only: no client can read one back, the reporter included.
// So the interface has no read method, and a submit resolves to null.

import type { DataError, Result } from './types';

export type ReportCategory = 'unsafe_driving' | 'harassment' | 'no_show' | 'vehicle_identity_mismatch' | 'other';

/** The five categories (0005's check constraint), in the order the form shows them. */
export const REPORT_CATEGORIES: readonly { value: ReportCategory; label: string }[] = [
  { value: 'unsafe_driving', label: 'Unsafe driving' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'no_show', label: 'No-show' },
  { value: 'vehicle_identity_mismatch', label: "Vehicle or identity didn't match" },
  { value: 'other', label: 'Something else' },
];

/** 0005: details are at most 4000 characters (char_length, so code points). */
export const MAX_REPORT_DETAILS = 4000;

/** A report ready to send. Every field but category is optional. */
export type NewReport = {
  category: ReportCategory;
  details: string | null;
  reportedUserId: string | null;
  rideId: string | null;
};

/** What the form holds while someone fills it in. */
export type ReportDraft = {
  category: ReportCategory | null;
  details: string;
  reportedUserId: string | null;
  rideId: string | null;
};

export interface ReportsApi {
  /** File a report. Resolves to null: nothing about the report is ever read back. */
  submitReport(report: NewReport): Promise<Result<null>>;
}

export const reportsKeys = {
  all: 'reports',
};

// D-07 (Decided 2026-10-08): reporters first see the emergency line; the owner checks
// reports daily and replies within 24 hours.
export const EMERGENCY_LINE = 'In immediate danger? Call 911.';
export const REPORT_SENT_TITLE = 'Report sent';
export const REPORT_SENT_BODY = 'We check reports every day and reply within 24 hours.';

export const REPORT_CATEGORY_ERROR = 'Choose what happened.';
export const REPORT_DETAILS_ERROR = `Keep the details under ${MAX_REPORT_DETAILS} characters.`;
export const REPORT_SELF_ERROR = "You can't report yourself.";
/** Every failure that isn't offline or an ended session: neutral, and never the server's message. */
export const REPORT_SEND_ERROR = "Your report wasn't sent. Try again.";

const CATEGORY_VALUES = new Set<string>(REPORT_CATEGORIES.map((c) => c.value));

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && CATEGORY_VALUES.has(value);
}

/** Length as Postgres char_length counts it (code points, not UTF-16 units). */
export function detailsLength(details: string): number {
  return [...details].length;
}

/** Turn the form into a report, or say what to fix. Details are trimmed; blank becomes null. */
export function validateReport(draft: ReportDraft): { ok: true; report: NewReport } | { ok: false; error: string } {
  if (!isReportCategory(draft.category)) return { ok: false, error: REPORT_CATEGORY_ERROR };
  const details = draft.details.trim();
  if (detailsLength(details) > MAX_REPORT_DETAILS) return { ok: false, error: REPORT_DETAILS_ERROR };
  return {
    ok: true,
    report: {
      category: draft.category,
      details: details === '' ? null : details,
      reportedUserId: draft.reportedUserId || null,
      rideId: draft.rideId || null,
    },
  };
}

/**
 * The checks both backends make before sending, mirroring 0005's constraints, so the
 * mock rejects what the database would and the Supabase backend sends nothing it would refuse.
 */
export function checkNewReport(report: NewReport, meId: string): DataError | null {
  if (!isReportCategory(report.category)) return { kind: 'invalid', message: REPORT_CATEGORY_ERROR };
  if (report.details !== null && detailsLength(report.details) > MAX_REPORT_DETAILS) {
    return { kind: 'invalid', message: REPORT_DETAILS_ERROR };
  }
  if (report.reportedUserId !== null && report.reportedUserId === meId) {
    return { kind: 'invalid', message: REPORT_SELF_ERROR };
  }
  return null;
}
