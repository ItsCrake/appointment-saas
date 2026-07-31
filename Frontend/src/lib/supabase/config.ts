/**
 * Auth is optional until the keys are filled in. Every entry point checks this
 * first so a missing key renders a setup notice instead of a stack trace.
 */
export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isSupabaseConfigured() {
  return getSupabaseConfig() !== null;
}
