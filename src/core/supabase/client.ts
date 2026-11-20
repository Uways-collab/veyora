import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getRuntimeConfig } from '../config/env';
import type { Database } from './types';

let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Returns a singleton browser Supabase client when VITE_SUPABASE_URL and
 * VITE_SUPABASE_ANON_KEY are configured. Returns null when unconfigured so the
 * UI can surface a clear setup state rather than failing with runtime errors.
 */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getRuntimeConfig();
  if (!config.isSupabaseConfigured) {
    return null;
  }

  cachedClient = createClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}
