// Pure sign-in rules shared by the auth provider and screens. No React Native
// imports here, so `npm test` can run this file under Node.

export const CODE_LENGTH = 6;
export const RESEND_AFTER_SECONDS = 60;

export const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
export const VERIFY_CODE_ERROR = "That code didn't work. Check it or request a new one.";
export const SAVE_PROFILE_ERROR = "Couldn't save your name. Check your connection and try again.";
export const SIGN_OUT_ERROR = "Couldn't sign out. Check your connection and try again.";
export const SERVER_ERROR = 'Something went wrong on our side. Try again in a few minutes.';

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw));
}

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Mirrors the `profiles_display_name_length` check in 0002_profiles_rls.sql.
 * Postgres `char_length` counts characters (code points), so this does too:
 * `String.length` would count an emoji as two UTF-16 code units.
 */
export function displayNameError(raw: string): string | null {
  const length = [...normalizeDisplayName(raw)].length;
  if (length < 2) return 'Enter at least 2 characters.';
  if (length > 40) return 'Use 40 characters or fewer.';
  return null;
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function isCompleteCode(raw: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(raw);
}

// `isValidEmail` is looser than Supabase Auth's own validation, so the server can
// still reject an address the client accepted.
const SERVER_REJECTED_EMAIL_CODES = ['email_address_invalid', 'validation_failed'];

/** Accepts a supabase-js `AuthError` directly. */
export function sendCodeErrorMessage(error: { status?: number; code?: string; message?: string }): string {
  if (error.code !== undefined && SERVER_REJECTED_EMAIL_CODES.includes(error.code)) return INVALID_EMAIL_ERROR;
  if (error.status === 429) return 'Too many codes requested. Try again in a few minutes.';
  // Closed pilot (D-11): with sign-ups off, Supabase Auth refuses an email that isn't
  // a confirmed user with HTTP 422. `signup_disabled` ("Signups not allowed for this
  // instance") when shouldCreateUser is true, `otp_disabled` ("Signups not allowed
  // for otp") when it is false. Match the code; fall back to the message only when
  // the error carries no code.
  const signupsOff =
    error.code === 'signup_disabled' ||
    error.code === 'otp_disabled' ||
    (error.code === undefined && /signups not allowed/i.test(error.message ?? ''));
  if (signupsOff) return "This email isn't on the Merge pilot list yet. Ask your pilot contact to add you.";
  if (error.status !== undefined && error.status >= 500) return SERVER_ERROR;
  return "Couldn't send the code. Check your connection and try again.";
}

export const DELETE_ACCOUNT_ERROR = "Couldn't delete your account. Check your connection and try again.";
export const DELETE_ACCOUNT_SESSION_ERROR = 'Your sign-in has expired. Sign out, sign back in, then try again.';
export const DELETE_ACCOUNT_UNAVAILABLE_ERROR =
  "Account deletion isn't available right now. Try again later, or ask your pilot contact to delete your account.";
export const DELETED_SIGN_OUT_ERROR =
  "Your account was deleted, but this device couldn't finish signing out. Check your connection and tap Sign out.";

/**
 * Reads `supabase.functions.invoke('delete-account')`'s result. Accepts supabase-js
 * `FunctionsError`s directly: a FunctionsHttpError's `context` is the Response.
 */
export function deleteAccountResult(result: {
  data: unknown;
  error: { name?: string; context?: unknown } | null;
}): { deleted: true } | { deleted: false; message: string } {
  const { data, error } = result;
  if (!error) {
    const deleted = typeof data === 'object' && data !== null && (data as { deleted?: unknown }).deleted === true;
    return deleted ? { deleted: true } : { deleted: false, message: DELETE_ACCOUNT_ERROR };
  }
  if (error.name === 'FunctionsRelayError') return { deleted: false, message: SERVER_ERROR };
  const context = error.context as { status?: unknown } | null | undefined;
  const status = error.name === 'FunctionsHttpError' && typeof context?.status === 'number' ? context.status : null;
  if (status === 401) return { deleted: false, message: DELETE_ACCOUNT_SESSION_ERROR };
  // The function isn't deployed yet (owner task O-09).
  if (status === 404) return { deleted: false, message: DELETE_ACCOUNT_UNAVAILABLE_ERROR };
  if (status !== null && status >= 500) return { deleted: false, message: SERVER_ERROR };
  return { deleted: false, message: DELETE_ACCOUNT_ERROR };
}

const PROFILE_RETRY_BASE_MS = 1000;
const PROFILE_RETRY_MAX_MS = 30000;

/**
 * Wait before retrying a failed profile lookup: 1s, 2s, 4s, ... capped at 30s.
 * `attempt` counts failures so far (0 for the first retry); negative or
 * non-finite values count as 0.
 */
export function profileRetryDelayMs(attempt: number): number {
  const failures = Number.isFinite(attempt) && attempt > 0 ? attempt : 0;
  return Math.min(PROFILE_RETRY_BASE_MS * 2 ** failures, PROFILE_RETRY_MAX_MS);
}

/**
 * `EXPO_PUBLIC_APP_ENV` values that mean a local or development build. eas.json
 * sets 'development', 'preview' or 'production' per profile; `expo start` leaves it
 * unset. Anything else counts as a release build, so a typo in a profile fails closed.
 */
const DEVELOPMENT_APP_ENVS: readonly (string | undefined)[] = [undefined, '', 'development'];

/** True for preview and production builds (and any APP_ENV eas.json doesn't define). */
export function isReleaseBuild(appEnv: string | undefined): boolean {
  return !DEVELOPMENT_APP_ENVS.includes(appEnv);
}

/**
 * 'prototype' is the click-through app on mock data, 'connected' signs in to Supabase,
 * and 'misconfigured' is a release build missing its Supabase config: it must refuse to
 * start rather than show testers fake people.
 */
export type AppMode = 'prototype' | 'connected' | 'misconfigured';

/** `configured` means both Supabase variables are set (src/lib/supabase.ts made a client). */
export function appMode(input: { appEnv: string | undefined; configured: boolean }): AppMode {
  if (input.configured) return 'connected';
  return isReleaseBuild(input.appEnv) ? 'misconfigured' : 'prototype';
}

export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'prototype' | 'misconfigured';

export function deriveStatus(input: {
  mode: AppMode;
  sessionLoaded: boolean;
  hasSession: boolean;
  profileLoaded: boolean;
  hasProfile: boolean;
}): AuthStatus {
  if (input.mode !== 'connected') return input.mode;
  if (!input.sessionLoaded) return 'loading';
  if (!input.hasSession) return 'signedOut';
  if (!input.profileLoaded) return 'loading';
  return input.hasProfile ? 'ready' : 'needsProfile';
}

/** First screen once the stored session and profile are known. */
export function launchRoute(status: Exclude<AuthStatus, 'loading'>): 'welcome' | 'discover' {
  return status === 'ready' ? 'discover' : 'welcome';
}

/** Where Welcome's Log in (after its animation) and the Role step's Continue go. */
export function welcomeNext(status: AuthStatus): 'signIn' | 'profileName' | 'commute' {
  if (status === 'signedOut') return 'signIn';
  if (status === 'needsProfile') return 'profileName';
  return 'commute';
}

const SIGNED_OUT_ROUTES = ['welcome', 'signIn', 'verifyCode', 'role'];

/** True when someone signed out (or their session ended) on a signed-in screen. */
export function mustLeaveRoute(status: AuthStatus, routeName: string): boolean {
  return status === 'signedOut' && !SIGNED_OUT_ROUTES.includes(routeName);
}
