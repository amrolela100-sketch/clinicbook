import assert from 'node:assert/strict';
import type { Pool } from 'pg';

export async function verifyRealtimePublication(pool: Pool) {
  const tables = await pool.query<{ tablename: string }>(
    "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' ORDER BY tablename",
  );
  assert.deepEqual(
    tables.rows.map((row) => row.tablename),
    ['appointments', 'medical_records', 'notifications'],
  );
  console.log('PASS Realtime invalidation publication membership (not a live streaming test)');
}
