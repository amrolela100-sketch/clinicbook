import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type RoleQuery = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
type UserQuery = <T = Record<string, unknown>>(
  uid: string,
  sql: string,
  args?: unknown[],
) => Promise<T[]>;

export async function verifyHealth(
  pool: Pool,
  asService: RoleQuery,
  asUser: UserQuery,
  asAnon: RoleQuery,
) {
  const properties = await pool.query<{
    stable: boolean;
    security_definer: boolean;
    result_type: string;
    configuration: string[];
    public_execute: boolean;
  }>(`
    SELECT p.provolatile = 's' AS stable,
           p.prosecdef AS security_definer,
           pg_get_function_result(p.oid) AS result_type,
           p.proconfig AS configuration,
           EXISTS (
             SELECT 1
             FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS public_execute
    FROM pg_proc p
    WHERE p.oid = to_regprocedure('public.healthcheck()')
  `);
  assert.deepEqual(properties.rows, [
    {
      stable: true,
      security_definer: true,
      result_type: 'jsonb',
      configuration: ['search_path=public, pg_temp'],
      public_execute: false,
    },
  ]);

  const result = await asService('SELECT public.healthcheck() AS healthcheck');
  assert.deepEqual(result, [{ healthcheck: { ok: true, schema: '20261111000012' } }]);

  const permissionDenied = (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === '42501';
  await assert.rejects(asAnon('SELECT public.healthcheck()'), permissionDenied);
  await assert.rejects(asUser(randomUUID(), 'SELECT public.healthcheck()'), permissionDenied);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query(
      'ALTER TABLE public.appointments RENAME TO healthcheck_missing_appointments',
    );
    await client.query('SET LOCAL ROLE service_role');
    const missingTable = await client.query('SELECT public.healthcheck() AS healthcheck');
    assert.deepEqual(missingTable.rows, [{ healthcheck: { ok: false, schema: '20261111000012' } }]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }

  console.log('PASS healthcheck: trusted RPC, restricted execute grants, and schema readiness');
}
