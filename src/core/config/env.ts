export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isSupabaseConfigured: boolean;
}

function normalizeEnvValue(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function getRuntimeConfig(): RuntimeConfig {
  const supabaseUrl = normalizeEnvValue(import.meta.env.VITE_SUPABASE_URL);
  const supabaseAnonKey = normalizeEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY);

  const isValidUrl =
    supabaseUrl.startsWith('https://') || supabaseUrl.startsWith('http://');

  return {
    supabaseUrl,
    supabaseAnonKey,
    isSupabaseConfigured: isValidUrl && supabaseAnonKey.length > 0,
  };
}
