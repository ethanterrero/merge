import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNewReport,
  detailsLength,
  MAX_REPORT_DETAILS,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_ERROR,
  REPORT_DETAILS_ERROR,
  REPORT_SEND_ERROR,
  validateReport,
  type NewReport,
  type ReportDraft,
  type ReportsApi,
} from './reports.api';
import { toReportInsert } from './reports.map';
import { createReportsMock, type ReportsMockOptions } from './reports.mock';
import { createReportsSupabase } from './reports.supabase';
import { errKind, ok, runContract } from './testing/contract';
import { fakeSupabase, type RecordedCall } from './testing/fakeSupabase';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const RIDE = '44444444-4444-4444-8444-444444444444';

const FULL: NewReport = { category: 'harassment', details: 'Rude comments at pickup.', reportedUserId: OTHER, rideId: RIDE };
const BARE: NewReport = { category: 'other', details: null, reportedUserId: null, rideId: null };

// Insert without RETURNING (no .select()): reporters can't read reports back.
const insertOnly = (report: NewReport) => (calls: RecordedCall[]) => {
  assert.deepEqual(calls, [
    {
      kind: 'from',
      target: 'safety_reports',
      ops: [
        {
          method: 'insert',
          args: [
            {
              reporter_id: ME,
              reported_user_id: report.reportedUserId,
              ride_id: report.rideId,
              category: report.category,
              details: report.details,
            },
          ],
        },
      ],
    },
  ]);
};

const noCalls = (calls: RecordedCall[]) => assert.deepEqual(calls, []);

runContract<ReportsApi, ReportsMockOptions>(
  'reports',
  {
    mock: (seed) => createReportsMock({ meId: ME, ...seed }),
    supabase: (client) => createReportsSupabase(client, ME),
  },
  [
    {
      name: 'a full report is inserted and resolves to null',
      server: { data: null, status: 201 },
      call: (api) => api.submitReport(FULL),
      expect: ok(null),
      checkCalls: insertOnly(FULL),
    },
    {
      name: 'a report with only a category is inserted with nulls',
      server: { data: null, status: 201 },
      call: (api) => api.submitReport(BARE),
      expect: ok(null),
      checkCalls: insertOnly(BARE),
    },
    {
      name: 'reporting yourself is invalid and sends nothing',
      call: (api) => api.submitReport({ ...FULL, reportedUserId: ME }),
      expect: errKind('invalid'),
      checkCalls: noCalls,
    },
    {
      name: 'an unknown category is invalid and sends nothing',
      call: (api) => api.submitReport({ ...BARE, category: 'spam' as NewReport['category'] }),
      expect: errKind('invalid'),
      checkCalls: noCalls,
    },
    {
      name: 'details over 4000 characters are invalid and send nothing',
      call: (api) => api.submitReport({ ...BARE, details: 'x'.repeat(MAX_REPORT_DETAILS + 1) }),
      expect: errKind('invalid'),
      checkCalls: noCalls,
    },
    {
      name: 'details of exactly 4000 characters are accepted',
      server: { data: null, status: 201 },
      call: (api) => api.submitReport({ ...BARE, details: 'x'.repeat(MAX_REPORT_DETAILS) }),
      expect: ok(null),
    },
    {
      name: "a ride that isn't mine (RLS) is notAllowed, with neutral copy",
      only: 'supabase',
      server: { error: { message: 'new row violates row-level security policy for table "safety_reports"', code: '42501' }, status: 403 },
      call: (api) => api.submitReport(FULL),
      expect: errKind('notAllowed'),
    },
    {
      name: 'a failed fetch (status 0) is offline',
      only: 'supabase',
      server: { error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      call: (api) => api.submitReport(FULL),
      expect: errKind('offline'),
    },
    {
      name: 'a thrown fetch error is offline, not an exception',
      only: 'supabase',
      server: { throws: new TypeError('Failed to fetch') },
      call: (api) => api.submitReport(FULL),
      expect: errKind('offline'),
    },
    {
      name: 'an injected failure surfaces as that error',
      only: 'mock',
      seed: { fail: (method) => (method === 'submitReport' ? { kind: 'server', message: 'x' } : null) },
      call: (api) => api.submitReport(FULL),
      expect: errKind('server'),
    },
  ],
);

test('server failures never show the server message', async () => {
  const cases = [
    { error: { message: 'insert or update on table violates foreign key constraint "safety_reports_reported_user_id_fkey"', code: '23503' }, status: 409 },
    { error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 },
    { error: { message: 'internal', code: 'XX000' }, status: 500 },
  ];
  for (const server of cases) {
    const { client } = fakeSupabase(server);
    const result = await createReportsSupabase(client, ME).submitReport(FULL);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.message, REPORT_SEND_ERROR);
      assert.ok(!result.error.message.includes(server.error.message));
    }
  }
});

test('the mock keeps what was sent only for its sink, never for read-back', async () => {
  const sent: NewReport[] = [];
  const mock = createReportsMock({ meId: ME, onSubmit: (report) => sent.push(report) });
  assert.deepEqual(await mock.submitReport(FULL), { ok: true, data: null });
  assert.deepEqual(sent, [FULL]);
  assert.deepEqual(Object.keys(mock), ['submitReport']);
  // A rejected report reaches no sink.
  await mock.submitReport({ ...FULL, reportedUserId: ME });
  assert.equal(sent.length, 1);
});

test('toReportInsert sends only the five granted columns', () => {
  assert.deepEqual(Object.keys(toReportInsert(FULL, ME)).sort(), [
    'category',
    'details',
    'reported_user_id',
    'reporter_id',
    'ride_id',
  ]);
});

test('there are exactly the five categories from 0005, each with a label', () => {
  assert.deepEqual(
    REPORT_CATEGORIES.map((c) => c.value),
    ['unsafe_driving', 'harassment', 'no_show', 'vehicle_identity_mismatch', 'other'],
  );
  for (const c of REPORT_CATEGORIES) assert.ok(c.label.length > 0);
});

const draft = (overrides: Partial<ReportDraft> = {}): ReportDraft => ({
  category: 'no_show',
  details: '',
  reportedUserId: OTHER,
  rideId: null,
  ...overrides,
});

test('validateReport needs a category', () => {
  assert.deepEqual(validateReport(draft({ category: null })), { ok: false, error: REPORT_CATEGORY_ERROR });
});

test('validateReport trims details and turns blank into null', () => {
  assert.deepEqual(validateReport(draft({ details: '   \n ' })), {
    ok: true,
    report: { category: 'no_show', details: null, reportedUserId: OTHER, rideId: null },
  });
  assert.deepEqual(validateReport(draft({ details: '  Never showed.  ' })), {
    ok: true,
    report: { category: 'no_show', details: 'Never showed.', reportedUserId: OTHER, rideId: null },
  });
});

test('validateReport counts characters the way Postgres does', () => {
  const emoji = '🚗'; // one code point, two UTF-16 units
  assert.equal(detailsLength(emoji.repeat(3)), 3);
  assert.equal(validateReport(draft({ details: emoji.repeat(MAX_REPORT_DETAILS) })).ok, true);
  assert.deepEqual(validateReport(draft({ details: 'x'.repeat(MAX_REPORT_DETAILS + 1) })), {
    ok: false,
    error: REPORT_DETAILS_ERROR,
  });
});

test('validateReport turns empty ids into null', () => {
  const result = validateReport(draft({ reportedUserId: '', rideId: '' }));
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.report.reportedUserId, null);
    assert.equal(result.report.rideId, null);
  }
});

test('checkNewReport mirrors the database constraints', () => {
  assert.equal(checkNewReport(FULL, ME), null);
  assert.equal(checkNewReport({ ...FULL, reportedUserId: ME }, ME)?.kind, 'invalid');
  assert.equal(checkNewReport({ ...BARE, details: 'x'.repeat(MAX_REPORT_DETAILS + 1) }, ME)?.kind, 'invalid');
});
