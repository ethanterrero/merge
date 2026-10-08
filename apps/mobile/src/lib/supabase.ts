import 'react-native-url-polyfill/auto';
// Installs a SQLite-backed `localStorage` global on iOS/Android (no-op on web,
// where the browser provides one). Supabase persists the auth session there.
import 'expo-sqlite/localStorage/install';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// No client is created until environment variables are configured. Without
// one, the app runs as the click-through prototype.
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
