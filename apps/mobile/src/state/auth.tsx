import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { appEnv, supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import {
  appMode,
  AuthStatus,
  DELETE_ACCOUNT_ERROR,
  DELETED_SIGN_OUT_ERROR,
  deleteAccountResult,
  deriveStatus,
  normalizeDisplayName,
  normalizeEmail,
  profileRetryDelayMs,
  SAVE_PROFILE_ERROR,
  sendCodeErrorMessage,
  SIGN_OUT_ERROR,
  VERIFY_CODE_ERROR,
} from '../lib/authRules';
import type { Role } from './commute';

export type Profile = Database['public']['Tables']['profiles']['Row'];

type Auth = {
  status: AuthStatus;
  email: string | null;
  profile: Profile | null;
  /** Each action resolves to an error message to show, or null on success. */
  sendCode: (email: string) => Promise<string | null>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  saveProfile: (input: { displayName: string; role: Role }) => Promise<string | null>;
  signOut: () => Promise<string | null>;
  /**
   * Deletes the signed-in account through the delete-account Edge Function, then signs
   * this device out (the Router returns to Welcome). Connected mode only.
   */
  deleteAccount: () => Promise<string | null>;
};

// The function purges the audit log (up to 12 s), deletes the user, then purges again.
const DELETE_ACCOUNT_TIMEOUT_MS = 45000;

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Mirrors `session` for signOut, which resolves after SIGNED_OUT has been delivered.
  const sessionRef = useRef<Session | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    // Fires INITIAL_SESSION right away with any session restored from storage.
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      sessionRef.current = next;
      setSession(next);
      setSessionLoaded(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    setProfile(null);
    setProfileLoaded(false);
    const client = supabase;
    if (!client || !userId) return;
    let cancelled = false;
    let loaded = false;
    let attempt = 0;
    let latest = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // A failed lookup is not "no profile yet": it leaves profileLoaded false, so
    // status stays 'loading' and a returning user is never asked for a name (and
    // saving never overwrites their stored role). It retries with backoff, and
    // right away when the app returns to the foreground.
    const load = () => {
      clearTimeout(timer);
      const request = ++latest;
      client
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled || loaded) return;
          if (error) {
            // A newer request owns the retry schedule.
            if (request !== latest) return;
            timer = setTimeout(load, profileRetryDelayMs(attempt));
            attempt += 1;
            return;
          }
          loaded = true;
          clearTimeout(timer);
          subscription.remove();
          setProfile(data ?? null);
          setProfileLoaded(true);
        });
    };

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !loaded) load();
    });
    load();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      subscription.remove();
    };
  }, [userId]);

  const value = useMemo<Auth>(() => {
    const client = supabase;
    return {
      status: deriveStatus({
        mode: appMode({ appEnv, configured: client !== null }),
        sessionLoaded,
        hasSession: session !== null,
        profileLoaded,
        hasProfile: profile !== null,
      }),
      email: session?.user.email ?? null,
      profile,
      sendCode: async (email) => {
        if (!client) return null;
        const { error } = await client.auth.signInWithOtp({
          email: normalizeEmail(email),
          options: { shouldCreateUser: true },
        });
        return error ? sendCodeErrorMessage(error) : null;
      },
      verifyCode: async (email, code) => {
        if (!client) return null;
        const { error } = await client.auth.verifyOtp({ email: normalizeEmail(email), token: code, type: 'email' });
        return error ? VERIFY_CODE_ERROR : null;
      },
      saveProfile: async ({ displayName, role }) => {
        if (!client || !session) return SAVE_PROFILE_ERROR;
        const { data, error } = await client
          .from('profiles')
          .upsert({ id: session.user.id, display_name: normalizeDisplayName(displayName), role })
          .select()
          .single();
        if (error || !data) return SAVE_PROFILE_ERROR;
        setProfile(data);
        return null;
      },
      signOut: async () => {
        if (!client) return null;
        const { error } = await client.auth.signOut();
        // An error is only a failed sign-out if the session is still there (offline with
        // an expired token). When the logout request fails some other way, auth-js has
        // already cleared the session and delivered SIGNED_OUT before this resolves, so
        // sessionRef is null and the person is signed out: don't tell them to try again.
        // getSession() can't answer this: with an expired token it retries the refresh,
        // and offline it returns no session while the stored one is still in place.
        return error && sessionRef.current ? SIGN_OUT_ERROR : null;
      },
      deleteAccount: async () => {
        if (!client || !session) return DELETE_ACCOUNT_ERROR;
        // invoke() sends the session's access token; the function deletes only that user.
        const result = deleteAccountResult(
          await client.functions.invoke('delete-account', { method: 'POST', timeout: DELETE_ACCOUNT_TIMEOUT_MS }),
        );
        if (!result.deleted) return result.message;
        // The account and its sessions are gone on the server; clear this device's copy.
        // signOut({ scope: 'local' }) still posts /logout?scope=local (auth-js 2.117). Auth
        // refuses it for the deleted user, and auth-js treats 401/403/404 as signed out and
        // clears the stored session; on other errors it clears it too and returns the error.
        const { error } = await client.auth.signOut({ scope: 'local' });
        return error && sessionRef.current ? DELETED_SIGN_OUT_ERROR : null;
      },
    };
  }, [session, sessionLoaded, profile, profileLoaded]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
