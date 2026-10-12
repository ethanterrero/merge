import { isReleaseBuild, normalizeEmail } from './authRules';

/**
 * A test account that signs in with a password instead of an emailed code, so local
 * development doesn't depend on email delivery. Create it in the Supabase dashboard
 * (README, Dev sign-in); it never ships, because app.config.js refuses a release build
 * with these variables set (devSignInGuard.js).
 */
export type DevSignInAccount = { email: string; password: string };

/** Offered only in a `__DEV__` bundle of a development build, connected to Supabase, with both variables set. */
export function devSignInAccount(input: {
  isDev: boolean;
  appEnv: string | undefined;
  configured: boolean;
  email: string | undefined;
  password: string | undefined;
}): DevSignInAccount | null {
  if (!input.isDev || isReleaseBuild(input.appEnv) || !input.configured) return null;
  const email = input.email?.trim();
  if (!email || !input.password) return null;
  return { email: normalizeEmail(email), password: input.password };
}

/** Developers see the raw Auth message: it says whether the user is missing or the password is wrong. */
export function devSignInErrorMessage(error: { message?: string }): string {
  return `Dev sign-in failed: ${error.message || 'unknown error'}`;
}
