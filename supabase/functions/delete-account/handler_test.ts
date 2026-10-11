import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19';
import {
  type AccountUser,
  bearerToken,
  deleteAuthUser,
  type DeleteAccountDeps,
  fetchAuthUser,
  handleDeleteAccount,
  PURGE_AUDIT_LOG_SQL,
  purgeAuditLogParams,
  purgeAuditLogWith,
  type SqlClient,
} from './handler.ts';

const ADA: AccountUser = { id: '00000000-0000-4000-8000-00000000000a', email: 'Ada@Example.com' };
const URL_BASE = 'https://project.supabase.co';

type Calls = { getUser: string[]; deleteUser: string[]; purge: AccountUser[]; logged: string[]; order: string[] };
type PurgeOutcome = 'ok' | 'fail' | 'hang';

/** `purges` scripts each purge call in turn (default: every purge succeeds). */
function deps(
  overrides: Partial<DeleteAccountDeps> = {},
  purges: PurgeOutcome[] = [],
): { deps: DeleteAccountDeps; calls: Calls } {
  const calls: Calls = { getUser: [], deleteUser: [], purge: [], logged: [], order: [] };
  return {
    calls,
    deps: {
      getUser: (token) => {
        calls.getUser.push(token);
        return Promise.resolve({ status: 'ok', user: ADA });
      },
      deleteUser: (id) => {
        calls.deleteUser.push(id);
        calls.order.push('delete');
        return Promise.resolve();
      },
      purgeAuditLog: (user) => {
        const outcome = purges[calls.purge.length] ?? 'ok';
        calls.purge.push(user);
        calls.order.push(`purge:${outcome}`);
        if (outcome === 'fail') return Promise.reject(new Error('permission denied'));
        if (outcome === 'hang') return new Promise<void>(() => {});
        return Promise.resolve();
      },
      logError: (message) => {
        calls.logged.push(message);
      },
      ...overrides,
    },
  };
}

function post(headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }): Request {
  return new Request(`${URL_BASE}/functions/v1/delete-account`, { method: 'POST', headers });
}

// ---------------------------------------------------------------------------
// bearerToken

Deno.test('bearerToken reads the token from a Bearer header', () => {
  assertEquals(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi');
  assertEquals(bearerToken('bearer   abc'), 'abc');
});

Deno.test('bearerToken rejects missing or malformed headers', () => {
  assertEquals(bearerToken(null), null);
  assertEquals(bearerToken(''), null);
  assertEquals(bearerToken('Bearer'), null);
  assertEquals(bearerToken('Bearer '), null);
  assertEquals(bearerToken('Basic abc'), null);
  assertEquals(bearerToken('Bearer a b'), null);
});

// ---------------------------------------------------------------------------
// handleDeleteAccount

Deno.test('purges the audit log, deletes the caller, purges again and reports success', async () => {
  const { deps: d, calls } = deps();
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: true });
  assertEquals(calls.getUser, ['user-jwt']);
  assertEquals(calls.deleteUser, [ADA.id]);
  // Before the delete, while the id and email are known; after it, for the delete's own entry.
  assertEquals(calls.order, ['purge:ok', 'delete', 'purge:ok']);
  assertEquals(calls.purge, [ADA, ADA]);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Content-Type'), 'application/json');
});

Deno.test('deletes only the user the token belongs to, whatever the body says', async () => {
  const { deps: d, calls } = deps();
  const req = new Request(`${URL_BASE}/functions/v1/delete-account`, {
    method: 'POST',
    headers: { Authorization: 'Bearer user-jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'someone-else', id: 'someone-else' }),
  });
  const res = await handleDeleteAccount(req, d);
  assertEquals(res.status, 200);
  assertEquals(calls.deleteUser, [ADA.id]);
});

Deno.test('answers the CORS preflight without touching Auth', async () => {
  const { deps: d, calls } = deps();
  const res = await handleDeleteAccount(new Request(URL_BASE, { method: 'OPTIONS' }), d);
  assertEquals(res.status, 200);
  await res.body?.cancel();
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  const allowed = res.headers.get('Access-Control-Allow-Headers') ?? '';
  for (const header of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
    assertEquals(allowed.includes(header), true, header);
  }
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assertEquals(calls.getUser.length, 0);
});

Deno.test('rejects other methods', async () => {
  const { deps: d, calls } = deps();
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const res = await handleDeleteAccount(new Request(URL_BASE, { method, headers: { Authorization: 'Bearer t' } }), d);
    assertEquals(res.status, 405);
    assertEquals(await res.json(), { error: 'method_not_allowed' });
    assertEquals(res.headers.get('Allow'), 'POST, OPTIONS');
  }
  assertEquals(calls.getUser.length, 0);
  assertEquals(calls.deleteUser.length, 0);
});

Deno.test('rejects a request without a bearer token', async () => {
  const { deps: d, calls } = deps();
  const res = await handleDeleteAccount(post({}), d);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(calls.getUser.length, 0);
  assertEquals(calls.deleteUser.length, 0);
});

Deno.test('rejects a token Auth does not accept, and deletes nothing', async () => {
  const { deps: d, calls } = deps({ getUser: () => Promise.resolve({ status: 'invalid' }) });
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: 'unauthorized' });
  assertEquals(calls.deleteUser.length, 0);
  assertEquals(calls.purge.length, 0);
});

Deno.test("treats a token whose user is already gone as deleted (a retry after a lost response)", async () => {
  const { deps: d, calls } = deps({ getUser: () => Promise.resolve({ status: 'not_found' }) });
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: false });
  assertEquals(calls.deleteUser.length, 0);
  assertEquals(calls.purge.length, 0);
});

Deno.test('reports 502 when Auth cannot be reached, and deletes nothing', async () => {
  const { deps: d, calls } = deps({ getUser: () => Promise.reject(new Error('boom')) });
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: 'auth_unavailable' });
  assertEquals(calls.deleteUser.length, 0);
  assertEquals(calls.logged.length, 1);
});

Deno.test('reports 500 when the delete fails, after only the first purge', async () => {
  const { deps: d, calls } = deps({ deleteUser: () => Promise.reject(new Error('db down')) });
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: 'delete_failed' });
  assertEquals(calls.order, ['purge:ok']);
  assertEquals(calls.logged.length, 1);
});

Deno.test('a failed first purge does not stop the delete; the second purge decides', async () => {
  const { deps: d, calls } = deps({}, ['fail', 'ok']);
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: true });
  assertEquals(calls.order, ['purge:fail', 'delete', 'purge:ok']);
  assertEquals(calls.logged.length, 1);
});

Deno.test('still reports the deletion when the second purge fails', async () => {
  const { deps: d, calls } = deps({}, ['ok', 'fail']);
  const res = await handleDeleteAccount(post(), d);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: false });
  assertEquals(calls.order, ['purge:ok', 'delete', 'purge:fail']);
  assertEquals(calls.logged.length, 1);
});

Deno.test('reports both purges failing, and still deletes', async () => {
  const { deps: d, calls } = deps({}, ['fail', 'fail']);
  const res = await handleDeleteAccount(post(), d);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: false });
  assertEquals(calls.deleteUser, [ADA.id]);
  assertEquals(calls.logged.length, 2);
});

Deno.test('gives up on purges that hang, and still deletes', async () => {
  const { deps: d, calls } = deps({}, ['hang', 'hang']);
  const res = await handleDeleteAccount(post(), d, { purgeTimeoutMs: 5 });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true, auditLogPurged: false });
  assertEquals(calls.order, ['purge:hang', 'delete', 'purge:hang']);
});

Deno.test('never logs the person’s id, email or token', async () => {
  const logged: unknown[] = [];
  const failing = new Error(`failed for ${ADA.id} ${ADA.email}`);
  const { deps: d } = deps({
    purgeAuditLog: () => Promise.reject(failing),
    deleteUser: () => Promise.reject(failing),
    logError: (message, error) => logged.push(message, error),
  });
  await (await handleDeleteAccount(post(), d)).body?.cancel();
  const text = JSON.stringify(logged);
  assertEquals(text.includes(ADA.id), false);
  assertEquals(text.includes(ADA.email!), false);
  assertEquals(text.includes('user-jwt'), false);
});

// ---------------------------------------------------------------------------
// fetchAuthUser

type Recorded = { url: string; init: RequestInit | undefined };

function fakeFetch(response: () => Response): { fetch: typeof fetch; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Promise.resolve(response());
  };
  return { fetch: fn as typeof fetch, requests };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.test('fetchAuthUser asks Auth who the token belongs to', async () => {
  const { fetch, requests } = fakeFetch(() => json(200, { id: ADA.id, email: ADA.email, role: 'authenticated' }));
  const result = await fetchAuthUser(fetch, `${URL_BASE}/`, 'anon-key', 'user-jwt');
  assertEquals(result, { status: 'ok', user: ADA });
  assertEquals(requests.length, 1);
  assertEquals(requests[0].url, `${URL_BASE}/auth/v1/user`);
  const headers = new Headers(requests[0].init?.headers);
  assertEquals(headers.get('apikey'), 'anon-key');
  assertEquals(headers.get('Authorization'), 'Bearer user-jwt');
});

Deno.test('fetchAuthUser treats a missing email as null', async () => {
  const { fetch } = fakeFetch(() => json(200, { id: ADA.id, email: '' }));
  assertEquals(await fetchAuthUser(fetch, URL_BASE, 'k', 't'), { status: 'ok', user: { id: ADA.id, email: null } });
});

Deno.test('fetchAuthUser reports a user that no longer exists', async () => {
  const { fetch } = fakeFetch(() =>
    json(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' })
  );
  assertEquals(await fetchAuthUser(fetch, URL_BASE, 'k', 't'), { status: 'not_found' });
});

Deno.test('fetchAuthUser reports other 401 and 403 answers as an invalid token', async () => {
  for (const [status, body] of [
    [401, { code: 401, error_code: 'no_authorization', msg: 'no' }],
    [403, { code: 403, error_code: 'bad_jwt', msg: 'invalid claim: missing sub claim' }],
    [403, { code: 403, error_code: 'session_not_found', msg: 'gone' }],
    [403, 'not json'],
  ] as const) {
    const { fetch } = fakeFetch(() =>
      typeof body === 'string' ? new Response(body, { status }) : json(status, body)
    );
    assertEquals(await fetchAuthUser(fetch, URL_BASE, 'k', 't'), { status: 'invalid' }, `${status}`);
  }
});

Deno.test('fetchAuthUser throws when Auth fails or answers without an id', async () => {
  await assertRejects(() => fakeAuth(json(500, { msg: 'down' })));
  await assertRejects(() => fakeAuth(json(200, { email: 'x@example.com' })));
  await assertRejects(() => fakeAuth(json(200, { id: '' })));
});

function fakeAuth(res: Response) {
  return fetchAuthUser(fakeFetch(() => res).fetch, URL_BASE, 'k', 't');
}

// ---------------------------------------------------------------------------
// deleteAuthUser

Deno.test('deleteAuthUser hard-deletes the user through the Auth admin API', async () => {
  const { fetch, requests } = fakeFetch(() => json(200, {}));
  await deleteAuthUser(fetch, `${URL_BASE}/`, 'service-key', ADA.id);
  assertEquals(requests.length, 1);
  assertEquals(requests[0].url, `${URL_BASE}/auth/v1/admin/users/${ADA.id}`);
  assertEquals(requests[0].init?.method, 'DELETE');
  const headers = new Headers(requests[0].init?.headers);
  assertEquals(headers.get('apikey'), 'service-key');
  assertEquals(headers.get('Authorization'), 'Bearer service-key');
  assertEquals(JSON.parse(String(requests[0].init?.body)), { should_soft_delete: false });
});

Deno.test('deleteAuthUser encodes the id into the path', async () => {
  const { fetch, requests } = fakeFetch(() => json(200, {}));
  await deleteAuthUser(fetch, URL_BASE, 'k', '../users');
  assertEquals(requests[0].url, `${URL_BASE}/auth/v1/admin/users/..%2Fusers`);
});

Deno.test('deleteAuthUser counts a user that is already gone as deleted', async () => {
  const { fetch } = fakeFetch(() => json(404, { code: 404, error_code: 'user_not_found' }));
  await deleteAuthUser(fetch, URL_BASE, 'k', ADA.id);
});

Deno.test('deleteAuthUser throws on any other failure', async () => {
  for (const status of [400, 401, 403, 500]) {
    const { fetch } = fakeFetch(() => json(status, { msg: 'no' }));
    await assertRejects(() => deleteAuthUser(fetch, URL_BASE, 'k', ADA.id));
  }
});

// ---------------------------------------------------------------------------
// audit-log purge

Deno.test('purgeAuditLogParams passes the id and the lowercased email', () => {
  assertEquals(purgeAuditLogParams(ADA), [ADA.id, 'ada@example.com']);
  assertEquals(purgeAuditLogParams({ id: ADA.id, email: null }), [ADA.id, null]);
  assertEquals(purgeAuditLogParams({ id: ADA.id, email: '  ' }), [ADA.id, null]);
});

Deno.test('the purge deletes only from auth.audit_log_entries, matching actor and subject', () => {
  const sql = PURGE_AUDIT_LOG_SQL.replace(/\s+/g, ' ').trim();
  assertEquals(sql.startsWith('delete from auth.audit_log_entries where'), true);
  for (const fragment of [
    "payload ->> 'actor_id' = $1",
    "payload -> 'traits' ->> 'user_id' = $1",
    "lower(payload ->> 'actor_username') = $2",
    "lower(payload -> 'traits' ->> 'user_email') = $2",
  ]) {
    assertEquals(sql.includes(fragment), true, fragment);
  }
  assertEquals(sql.includes(';'), false);
});

// ---------------------------------------------------------------------------
// purgeAuditLogWith

type FakeSql = SqlClient & { log: string[]; params: unknown[][] };

function fakeSql(behaviour: { connect?: 'ok' | 'hang' | 'fail'; query?: 'ok' | 'fail'; end?: 'ok' | 'hang' | 'fail' } = {}): FakeSql {
  const log: string[] = [];
  const params: unknown[][] = [];
  const outcome = (kind: 'ok' | 'hang' | 'fail' | undefined) =>
    kind === 'hang' ? new Promise<void>(() => {}) : kind === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve();
  return {
    log,
    params,
    connect: () => {
      log.push('connect');
      return outcome(behaviour.connect);
    },
    queryArray: (sql: string, args?: unknown[]) => {
      const text = sql.replace(/\s+/g, ' ').trim();
      log.push(text.startsWith('delete from auth.audit_log_entries') ? 'delete' : text);
      if (args) params.push(args);
      return text.startsWith('delete') && behaviour.query === 'fail' ? Promise.reject(new Error('x')) : Promise.resolve();
    },
    end: () => {
      log.push('end');
      return outcome(behaviour.end);
    },
  };
}

Deno.test('purgeAuditLogWith deletes in a transaction with a server-side statement timeout, then closes', async () => {
  const sql = fakeSql();
  await purgeAuditLogWith(sql, ADA);
  assertEquals(sql.log, ['connect', 'begin', 'set local statement_timeout = 8000', 'delete', 'commit', 'end']);
  assertEquals(sql.params, [[ADA.id, 'ada@example.com']]);
});

Deno.test('purgeAuditLogWith closes the connection when the delete fails', async () => {
  const sql = fakeSql({ query: 'fail' });
  await assertRejects(() => purgeAuditLogWith(sql, ADA));
  assertEquals(sql.log, ['connect', 'begin', 'set local statement_timeout = 8000', 'delete', 'end']);
});

Deno.test('purgeAuditLogWith closes the connection when connecting fails', async () => {
  const sql = fakeSql({ connect: 'fail' });
  await assertRejects(() => purgeAuditLogWith(sql, ADA));
  assertEquals(sql.log, ['connect', 'end']);
});

Deno.test('purgeAuditLogWith gives up on a connection that hangs', async () => {
  const sql = fakeSql({ connect: 'hang' });
  await assertRejects(() => purgeAuditLogWith(sql, ADA, { connectTimeoutMs: 5 }), Error, 'connect timed out');
  assertEquals(sql.log, ['connect', 'end']);
});

Deno.test('purgeAuditLogWith does not wait on, or fail because of, closing the connection', async () => {
  await purgeAuditLogWith(fakeSql({ end: 'fail' }), ADA);
  await purgeAuditLogWith(fakeSql({ end: 'hang' }), ADA, { endTimeoutMs: 5 });
});
