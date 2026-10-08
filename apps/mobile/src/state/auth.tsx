import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import {
  AuthStatus,
  deriveStatus,
  normalizeDisplayName,
  normalizeEmail,
  SAVE_PROFILE_ERROR,
  sendCodeErrorMessage,
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
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    // Fires INITIAL_SESSION right away with any session restored from storage.
    const { data } = client.auth.onAuthStateChange((_event, next) => {
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
    client
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // A failed lookup reads as "no profile yet". Saving upserts, so the
        // worst case is asking for a name the person already gave.
        setProfile(data ?? null);
        setProfileLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const value = useMemo<Auth>(() => {
    const client = supabase;
    return {
      status: deriveStatus({
        configured: client !== null,
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
        if (client) await client.auth.signOut();
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
