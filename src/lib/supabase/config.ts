/**
 * Edge-safe Supabase configuration check.
 * Importable from middleware (Edge Runtime) without pulling in
 * `better-sqlite3` or `next/headers`.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
