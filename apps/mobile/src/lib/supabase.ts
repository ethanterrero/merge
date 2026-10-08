import 'react-native-url-polyfill/auto';
// Installs a SQLite-backed `localStorage` global on iOS/Android (no-op on web,
// where the browser provides one). Supabase persists the auth session there.
import 'expo-sqlite/localStorage/install';
import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// No client is created until environment variables are configured.
export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        storage: localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
