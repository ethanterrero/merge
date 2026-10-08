import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// No client is created until environment variables are configured.
export const supabase = url && anonKey
  ? createClient(url, anonKey, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : SQLite.localStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;
