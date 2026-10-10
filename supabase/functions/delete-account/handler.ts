// Request handling for the delete-account Edge Function. Dependency-free: no Deno
// globals, network or database access here. index.ts injects them, so handler_test.ts
// covers everything under `deno test`.
//
// Policy: docs/superpowers/specs/2026-10-08-account-deletion-design.md (D-15). Deleting
// the auth.users row cascades to the profile, and the profile's deletion policy
// (0010_account_deletion.sql and later) handles everything else. Only
// auth.audit_log_entries is outside the cascade, so this function purges it.

export type AccountUser = { id: string; email: string | null };

/** What Auth says about an access token. */
export type UserLookup =
  | { status: 'ok'; user: AccountUser }
  /** Signed by this project, but its user no longer exists (already deleted). */
  | { status: 'not_found' }
  /** Not a live user session: expired, signed out, or an API key instead of a user token. */
  | { status: 'invalid' };

export type DeleteAccountDeps = {
  /** Throws when Auth can't answer. */
  getUser: (accessToken: string) => Promise<UserLookup>;
  /** Deletes the auth.users row. Throws on failure. */
  deleteUser: (userId: string) => Promise<void>;
  /** Removes the person's auth.audit_log_entries rows. Throws on failure. */
  purgeAuditLog: (user: AccountUser) => Promise<void>;
  /** Server log. Gets a fixed message and the error's name only, never identifiers. */
  logError: (message: string, errorName: string) => void;
};

export const PURGE_TIMEOUT_MS = 10_000;

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? '');
  return match ? match[1] : null;
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extra },
  });
}

// Error messages can carry ids or emails (from Postgres or Auth), so only the name is logged.
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Deletes the account the caller's access token belongs to, and nothing else: the user
 * id comes only from Auth's answer for that token, never from the request body.
 */
export async function handleDeleteAccount(
  req: Request,
  deps: DeleteAccountDeps,
  options: { purgeTimeoutMs?: number } = {},
): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });

  const token = bearerToken(req.headers.get('Authorization'));
  if (!token) return json(401, { error: 'unauthorized' });

  let lookup: UserLookup;
  try {
    lookup = await deps.getUser(token);
  } catch (error) {
    deps.logError('delete-account: user lookup failed', errorName(error));
    return json(502, { error: 'auth_unavailable' });
  }
  if (lookup.status === 'invalid') return json(401, { error: 'unauthorized' });
  // A retry after a lost response: the account is already gone.
  if (lookup.status === 'not_found') return json(200, { deleted: true, auditLogPurged: false });

  const { user } = lookup;
  try {
    await deps.deleteUser(user.id);
  } catch (error) {
    deps.logError('delete-account: delete failed', errorName(error));
    return json(500, { error: 'delete_failed' });
  }

  // After the delete, because deleting the user writes its own audit entry.
  let auditLogPurged = true;
  try {
    await withTimeout(deps.purgeAuditLog(user), options.purgeTimeoutMs ?? PURGE_TIMEOUT_MS);
  } catch (error) {
    auditLogPurged = false;
    deps.logError('delete-account: audit log purge failed; see the account-deletion spec', errorName(error));
  }
  return json(200, { deleted: true, auditLogPurged });
}

function authUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1${path}`;
}

/** `GET /auth/v1/user`: who the access token belongs to, checked by Auth itself. */
export async function fetchAuthUser(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
): Promise<UserLookup> {
  const res = await fetchFn(authUrl(supabaseUrl, '/user'), {
    headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => null);
    return body?.error_code === 'user_not_found' ? { status: 'not_found' } : { status: 'invalid' };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Auth user lookup failed with HTTP ${res.status}`);
  }
  const body = await res.json();
  if (typeof body?.id !== 'string' || body.id === '') throw new Error('Auth user lookup returned no id');
  const email = typeof body.email === 'string' && body.email !== '' ? body.email : null;
  return { status: 'ok', user: { id: body.id, email } };
}

/** `DELETE /auth/v1/admin/users/{id}`, the endpoint behind `auth.admin.deleteUser`. */
export async function deleteAuthUser(
  fetchFn: typeof fetch,
  supabaseUrl: string,
  serviceRoleKey: string,
  userId: string,
): Promise<void> {
  const res = await fetchFn(authUrl(supabaseUrl, `/admin/users/${encodeURIComponent(userId)}`), {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' },
    // A hard delete: a soft delete would keep the row and skip the deletion policy.
    body: JSON.stringify({ should_soft_delete: false }),
  });
  await res.body?.cancel();
  // Gone already (a concurrent request deleted it): the outcome the caller asked for.
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`Auth admin delete failed with HTTP ${res.status}`);
}

/**
 * Entries the person made (actor) or that were about them (traits), by id, and by email
 * when Auth knew one: sign-up, sign-in and code emails record the address as
 * `actor_username` or `traits.user_email`.
 */
export const PURGE_AUDIT_LOG_SQL = `
delete from auth.audit_log_entries
where payload ->> 'actor_id' = $1
   or payload -> 'traits' ->> 'user_id' = $1
   or ($2::text is not null and (
     lower(payload ->> 'actor_username') = $2
     or lower(payload -> 'traits' ->> 'user_email') = $2
   ))
`;

export function purgeAuditLogParams(user: AccountUser): [string, string | null] {
  const email = user.email?.trim().toLowerCase() ?? '';
  return [user.id, email === '' ? null : email];
}
