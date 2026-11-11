import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type IndexExpectation = {
  name: string;
  table: string;
  columns: string[];
  descending: boolean[];
  pendingOnly?: boolean;
};

type CatalogueIndex = {
  indexname: string;
  tablename: string;
  indexdef: string;
  access_method: string;
  is_valid: boolean;
  is_ready: boolean;
  is_unique: boolean;
  key_columns: string[];
  descending: boolean[];
  included_column_count: number;
  predicate: string | null;
};

type PlanNode = {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
};

function planNodes(plan: PlanNode): PlanNode[] {
  return [plan, ...(plan.Plans ?? []).flatMap(planNodes)];
}

async function assertIndexPath(
  client: PoolClient,
  indexName: string,
  sql: string,
  args: unknown[],
  conditionColumns: string[],
) {
  const result = await client.query<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
    `EXPLAIN (FORMAT JSON) ${sql}`,
    args,
  );
  const plan = result.rows[0]?.['QUERY PLAN'][0]?.Plan;
  assert.ok(plan, 'PostgreSQL must return an EXPLAIN plan');
  const nodes = planNodes(plan);
  const scan = nodes.find((node) => node['Index Name'] === indexName);
  assert.ok(scan, `${indexName} must support this query: ${JSON.stringify(plan)}`);
  for (const column of conditionColumns) {
    assert.match(
      scan['Index Cond'] ?? '',
      new RegExp(`\\b${column}\\b`),
      `${indexName} must use ${column} as an index condition, not a post-scan filter`,
    );
  }
  assert.ok(
    !nodes.some((node) => node['Node Type'].includes('Sort')),
    `${indexName} must support the requested ordering without a sort`,
  );
}

export async function verifyIndexes(pool: Pool): Promise<void> {
  const expectedIndexes: IndexExpectation[] = [
    {
      name: 'idx_availability_doctor_clinic_day',
      table: 'availability',
      columns: ['doctor_id', 'clinic_id', 'day_of_week'],
      descending: [false, false, false],
    },
    {
      name: 'idx_medical_records_patient_updated_at',
      table: 'medical_records',
      columns: ['patient_id', 'updated_at'],
      descending: [false, false],
    },
    {
      name: 'idx_medical_records_doctor_updated_at',
      table: 'medical_records',
      columns: ['doctor_id', 'updated_at'],
      descending: [false, false],
    },
    {
      name: 'idx_audit_logs_org_created_at',
      table: 'audit_logs',
      columns: ['organization_id', 'created_at'],
      descending: [false, true],
    },
    {
      name: 'idx_audit_logs_created_at',
      table: 'audit_logs',
      columns: ['created_at'],
      descending: [true],
    },
    {
      name: 'idx_appointments_pending_expiry_global',
      table: 'appointments',
      columns: ['expires_at'],
      descending: [false],
      pendingOnly: true,
    },
    // Staff booking still expires holds for a single doctor using this existing index.
    {
      name: 'idx_appointments_pending_expiry',
      table: 'appointments',
      columns: ['doctor_id', 'expires_at'],
      descending: [false, false],
      pendingOnly: true,
    },
  ];

  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const indexes = await client.query<CatalogueIndex>(
      `SELECT ix.indexname, ix.tablename, ix.indexdef,
              am.amname AS access_method,
              i.indisvalid AS is_valid, i.indisready AS is_ready,
              i.indisunique AS is_unique,
              ARRAY(
                SELECT a.attname::text
                FROM unnest(i.indkey) WITH ORDINALITY AS keys(attnum, position)
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = keys.attnum
                WHERE keys.position <= i.indnkeyatts
                ORDER BY keys.position
              ) AS key_columns,
              ARRAY(
                SELECT pg_index_column_has_property(i.indexrelid, keys.position, 'desc')
                FROM generate_series(1, i.indnkeyatts) AS keys(position)
                ORDER BY keys.position
              ) AS descending,
              i.indnatts - i.indnkeyatts AS included_column_count,
              pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_indexes ix
       JOIN pg_namespace ns ON ns.nspname = ix.schemaname
       JOIN pg_class c ON c.relnamespace = ns.oid AND c.relname = ix.indexname
       JOIN pg_index i ON i.indexrelid = c.oid
       JOIN pg_am am ON am.oid = c.relam
       WHERE ix.schemaname = 'public' AND ix.indexname = ANY($1::text[])`,
      [expectedIndexes.map((index) => index.name)],
    );

    for (const expected of expectedIndexes) {
      const index = indexes.rows.find((row) => row.indexname === expected.name);
      assert.ok(index, `Missing hot-path index: ${expected.name}`);
      assert.equal(index.tablename, expected.table, expected.name);
      assert.equal(index.access_method, 'btree', expected.name);
      assert.equal(index.is_valid, true, `${expected.name} must be usable by the planner`);
      assert.equal(index.is_ready, true, `${expected.name} must be maintained by writes`);
      assert.equal(
        index.is_unique,
        false,
        `${expected.name} must not introduce a unique constraint`,
      );
      assert.deepEqual(index.key_columns, expected.columns, `${expected.name} key order`);
      assert.deepEqual(index.descending, expected.descending, `${expected.name} sort direction`);
      assert.equal(index.included_column_count, 0, `${expected.name} must remain a minimal index`);
      if (expected.pendingOnly) {
        assert.match(
          index.predicate ?? '',
          /^\(status = 'pending'::(?:public\.)?appointment_status\)$/,
          `${expected.name} must contain only pending appointments`,
        );
        assert.match(
          index.indexdef,
          / WHERE \(status = 'pending'::(?:public\.)?appointment_status\)$/,
          `${expected.name} partial predicate must be present in pg_indexes`,
        );
      } else {
        assert.equal(index.predicate, null, `${expected.name} must cover all matching rows`);
        assert.ok(!/\bWHERE\b/.test(index.indexdef), `${expected.name} must not be partial`);
      }
    }

    // These switches test index-path capability, not the optimizer's choice on a tiny fixture.
    // EXPLAIN does not execute queries, and ROLLBACK restores every planner setting.
    await client.query('SET LOCAL enable_seqscan = off');
    await client.query('SET LOCAL enable_bitmapscan = off');
    await client.query('SET LOCAL enable_sort = off');
    const id = randomUUID();
    await assertIndexPath(
      client,
      'idx_availability_doctor_clinic_day',
      `SELECT id FROM public.availability
       WHERE doctor_id = $1 AND clinic_id = $2 AND day_of_week = $3 AND is_active`,
      [id, randomUUID(), 1],
      ['doctor_id', 'clinic_id', 'day_of_week'],
    );
    await assertIndexPath(
      client,
      'idx_medical_records_patient_updated_at',
      `SELECT id FROM public.medical_records
       WHERE patient_id = $1 AND is_visible_to_patient ORDER BY updated_at DESC LIMIT 30`,
      [id],
      ['patient_id'],
    );
    await assertIndexPath(
      client,
      'idx_medical_records_doctor_updated_at',
      `SELECT id FROM public.medical_records
       WHERE doctor_id = $1 ORDER BY updated_at DESC LIMIT 30`,
      [id],
      ['doctor_id'],
    );
    await assertIndexPath(
      client,
      'idx_audit_logs_org_created_at',
      `SELECT id FROM public.audit_logs
       WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 30`,
      [id],
      ['organization_id'],
    );
    await assertIndexPath(
      client,
      'idx_audit_logs_created_at',
      'SELECT id FROM public.audit_logs ORDER BY created_at DESC LIMIT 30',
      [],
      [],
    );
    // The cron predicate has no doctor restriction; ordering proves an expiry-leading path.
    await assertIndexPath(
      client,
      'idx_appointments_pending_expiry_global',
      `SELECT id FROM public.appointments
       WHERE status = 'pending' AND expires_at <= now() ORDER BY expires_at`,
      [],
      ['expires_at'],
    );
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }

  console.log(
    'PASS hot-path indexes: catalogue keys, predicates, and ordered index-path capability',
  );
}
