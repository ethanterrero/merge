// delete-account: deletes the signed-in caller's account (App Store guideline 5.1.1(v)).
//
// Auth: config.toml sets verify_jwt = true, so the gateway rejects requests without a
// JWT signed by this project; handler.ts then asks Auth whose live session the token is.
// Secrets: only the ones Supabase injects into every function (SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL). Nothing to set.
// Deploy (owner, O-09): `supabase functions deploy delete-account`.

import { Client } from 'jsr:@db/postgres@0.19.5';
import {
  type AccountUser,
  deleteAuthUser,
  fetchAuthUser,
  handleDeleteAccount,
  PURGE_AUDIT_LOG_SQL,
  purgeAuditLogParams,
} from './handler.ts';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// auth.audit_log_entries isn't exposed through the Data API, so this goes straight to
// Postgres as the project's database owner.
async function purgeAuditLog(user: AccountUser): Promise<void> {
  const client = new Client(env('SUPABASE_DB_URL'));
  await client.connect();
  try {
    await client.queryArray(PURGE_AUDIT_LOG_SQL, purgeAuditLogParams(user));
  } finally {
    await client.end();
  }
}

Deno.serve((req) =>
  handleDeleteAccount(req, {
    getUser: (token) => fetchAuthUser(fetch, env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), token),
    deleteUser: (id) => deleteAuthUser(fetch, env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), id),
    purgeAuditLog,
    logError: (message, errorName) => console.error(`${message} (${errorName})`),
  })
);
