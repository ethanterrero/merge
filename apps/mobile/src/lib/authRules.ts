// Pure sign-in rules shared by the auth provider and screens. No React Native
// imports here, so `npm test` can run this file under Node.

export const CODE_LENGTH = 6;
export const RESEND_AFTER_SECONDS = 60;

export const INVALID_EMAIL_ERROR = 'Enter a valid email address.';
export const VERIFY_CODE_ERROR = "That code didn't work. Check it or request a new one.";
export const SAVE_PROFILE_ERROR = "Couldn't save your name. Check your connection and try again.";
export const SIGN_OUT_ERROR = "Couldn't sign out. Check your connection and try again.";

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
export function sendCodeErrorMessage(error: { status?: number; code?: string }): string {
  if (error.code !== undefined && SERVER_REJECTED_EMAIL_CODES.includes(error.code)) return INVALID_EMAIL_ERROR;
  if (error.status === 429) return 'Too many codes requested. Try again in a few minutes.';
  return "Couldn't send the code. Check your connection and try again.";
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

export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready' | 'prototype';

export function deriveStatus(input: {
  configured: boolean;
  sessionLoaded: boolean;
  hasSession: boolean;
  profileLoaded: boolean;
  hasProfile: boolean;
}): AuthStatus {
  if (!input.configured) return 'prototype';
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
