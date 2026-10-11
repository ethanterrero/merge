import 'react-native-url-polyfill/auto';
// Installs a SQLite-backed `localStorage` global on iOS/Android (no-op on web,
// where the browser provides one). Supabase persists the auth session there.
import 'expo-sqlite/localStorage/install';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Which build this is: eas.json sets 'development', 'preview' or 'production' per
 * profile, and local `expo start` leaves it unset. Read as a literal
 * `process.env.EXPO_PUBLIC_*` so Expo inlines it into the bundle.
 */
export const appEnv = process.env.EXPO_PUBLIC_APP_ENV;

// No client is created until environment variables are configured. Without one,
// a development build runs as the click-through prototype, and a preview or
// production build refuses to start (appMode in authRules.ts).
export const supabase = url && anonKey
  ? createClient<Database>(url, anonKey, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Refresh tokens only while the app is in the foreground, per Supabase's
// React Native guidance. Browsers handle this themselves.
if (supabase && Platform.OS !== 'web') {
  const client = supabase;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') client.auth.startAutoRefresh();
    else client.auth.stopAutoRefresh();
  });
}
