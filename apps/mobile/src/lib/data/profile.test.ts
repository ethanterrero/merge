import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProfileApi, ProfileSummary } from './profile.api';
import { PROFILE_COLUMNS, toProfileSummary, toRidePrefs, toRole, type ProfileRow } from './profile.map';
import { createProfileMock, DEFAULT_PROFILES, PROTOTYPE_MEMBER_ID, type ProfileMockOptions } from './profile.mock';
import { createProfileSupabase } from './profile.supabase';
import { errKind, ok, runContract } from './testing/contract';
import type { RecordedCall } from './testing/fakeSupabase';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const ME_ROW: ProfileRow = {
  id: ME,
  display_name: 'Priya Sharma',
  role: 'driver',
  ride_prefs: ['quiet', 'smoke_free'],
  discovery_opt_in: true,
};
const ME_SUMMARY: ProfileSummary = {
  id: ME,
  displayName: 'Priya Sharma',
  role: 'driver',
  ridePrefs: ['Quiet ride', 'Smoke-free'],
  discoveryOptIn: true,
};
const OTHER_SUMMARY: ProfileSummary = { ...ME_SUMMARY, id: OTHER, displayName: 'Jordan Tran' };

const byIdQuery = (id: string) => (calls: RecordedCall[]) => {
  assert.deepEqual(calls, [
    {
      kind: 'from',
      target: 'profiles',
      ops: [
        { method: 'select', args: [PROFILE_COLUMNS] },
        { method: 'eq', args: ['id', id] },
        { method: 'maybeSingle', args: [] },
      ],
    },
  ]);
};

runContract<ProfileApi, ProfileMockOptions>(
  'profile',
  {
    mock: (seed) => createProfileMock({ meId: ME, profiles: [ME_SUMMARY, OTHER_SUMMARY], ...seed }),
    supabase: (client) => createProfileSupabase(client, ME),
  },
  [
    {
      name: 'my profile maps to the UI type',
      server: { data: ME_ROW },
      call: (api) => api.getMyProfile(),
      expect: ok(ME_SUMMARY),
      checkCalls: byIdQuery(ME),
    },
    {
      name: 'my profile before it exists is null',
      seed: { profiles: [] },
      server: { data: null },
      call: (api) => api.getMyProfile(),
      expect: ok(null),
    },
    {
      name: 'my own id by id returns my profile',
      server: { data: ME_ROW },
      call: (api) => api.getProfile(ME),
      expect: ok(ME_SUMMARY),
    },
    {
      name: 'an unknown id is null, never another profile',
      server: { data: null },
      call: (api) => api.getProfile('nobody'),
      expect: ok(null),
      checkCalls: byIdQuery('nobody'),
    },
    {
      name: "another member's profile is null (RLS hides it), not an error",
      server: { data: null },
      call: (api) => api.getProfile(OTHER),
      expect: ok(null),
    },
    {
      name: 'a failed fetch (status 0) is offline',
      only: 'supabase',
      server: { error: { message: 'TypeError: Network request failed', code: '' }, status: 0 },
      call: (api) => api.getMyProfile(),
      expect: errKind('offline'),
    },
    {
      name: 'a thrown fetch error is offline, not an exception',
      only: 'supabase',
      server: { throws: new TypeError('Failed to fetch') },
      call: (api) => api.getProfile(OTHER),
      expect: errKind('offline'),
    },
    {
      name: 'a server error is server',
      only: 'supabase',
      server: { error: { message: 'internal', code: 'XX000' }, status: 500 },
      call: (api) => api.getMyProfile(),
      expect: errKind('server'),
    },
    {
      name: 'an injected failure surfaces as that error',
      only: 'mock',
      seed: { fail: (method) => (method === 'getMyProfile' ? { kind: 'server', message: 'x' } : null) },
      call: (api) => api.getMyProfile(),
      expect: errKind('server'),
    },
  ],
);

test('the default mock is the prototype member, with discovery off', async () => {
  const mock = createProfileMock();
  assert.deepEqual(await mock.getMyProfile(), { ok: true, data: DEFAULT_PROFILES[0] });
  assert.equal(DEFAULT_PROFILES[0].id, PROTOTYPE_MEMBER_ID);
  assert.equal(DEFAULT_PROFILES[0].discoveryOptIn, false);
});

test('mock instances never share state', async () => {
  const a = createProfileMock({ profiles: [] });
  const b = createProfileMock();
  assert.deepEqual(await a.getMyProfile(), { ok: true, data: null });
  assert.deepEqual(await b.getMyProfile(), { ok: true, data: DEFAULT_PROFILES[0] });
});

test('toRole keeps known roles and falls back to the database default', () => {
  assert.equal(toRole('driver'), 'driver');
  assert.equal(toRole('passenger'), 'passenger');
  assert.equal(toRole('both'), 'both');
  assert.equal(toRole('admin'), 'both');
  assert.equal(toRole(''), 'both');
});

test('toRidePrefs maps known codes to labels and drops anything else', () => {
  assert.deepEqual(toRidePrefs(['quiet', 'smoke_free']), ['Quiet ride', 'Smoke-free']);
  assert.deepEqual(toRidePrefs(['smoke_free', 'women_only', 'toString', '__proto__', '']), ['Smoke-free']);
  assert.deepEqual(toRidePrefs([]), []);
});

test('toProfileSummary copies only the UI fields', () => {
  assert.deepEqual(toProfileSummary(ME_ROW), ME_SUMMARY);
  assert.deepEqual(Object.keys(toProfileSummary(ME_ROW)).sort(), [
    'discoveryOptIn',
    'displayName',
    'id',
    'ridePrefs',
    'role',
  ]);
});

test('the Supabase backend never selects *', () => {
  assert.ok(!PROFILE_COLUMNS.includes('*'));
});
