import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

type RoleQuery = <T = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
type UserQuery = <T = Record<string, unknown>>(
  uid: string,
  sql: string,
  args?: unknown[],
) => Promise<T[]>;

type Counts = {
  expiredCount: number;
  noShowCount: number;
  reminderCount: number;
  subscriptionExpiredCount: number;
  archivedCount: number;
};

export async function verifyCron(context: {
  pool: Pool;
  asService: RoleQuery;
  asUser: UserQuery;
  asAnon: RoleQuery;
  organizationId: string;
  clinicId: string;
  doctorId: string;
  patientId: string;
  ownerId: string;
}) {
  const {
    pool,
    asService,
    asUser,
    asAnon,
    organizationId,
    clinicId,
    doctorId,
    patientId,
    ownerId,
  } = context;
  const pending = randomUUID();
  const upcoming = randomUUID();
  const missed = randomUUID();
  const checkedIn = randomUUID();
  const archival = randomUUID();
  const held = randomUUID();

  for (const [id, offset, status, expires] of [
    [pending, "interval '2 hours'", 'pending', "now()-interval '1 minute'"],
    [upcoming, "interval '3 hours'", 'confirmed', 'NULL'],
    [missed, "interval '-8 days'", 'confirmed', 'NULL'],
    [checkedIn, "interval '-9 days'", 'checked_in', 'NULL'],
    [archival, "interval '-10 days'", 'completed', 'NULL'],
    [held, "interval '-11 days'", 'completed', 'NULL'],
  ]) {
    await pool.query(
      `INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status,expires_at)
       VALUES($1,$2,$3,$4,$5,now()+${offset},now()+${offset}+interval '30 minutes',$6,${expires})`,
      [id, organizationId, clinicId, doctorId, patientId, status],
    );
  }

  for (const id of [archival, held]) {
    await pool.query(
      "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'cron-retention-fixture')",
      [id, organizationId, doctorId, patientId],
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: 'service_role' }),
    ]);
    await client.query(
      'UPDATE medical_records SET retention_until=current_date-1,legal_hold=(appointment_id=$2) WHERE appointment_id IN ($1,$2)',
      [archival, held],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const expiredOrg = randomUUID();
  await pool.query(
    "INSERT INTO organizations(id,name,slug,owner_id,verification_status) VALUES($1::uuid,'cron expiry fixture',$1::text,$2,'approved')",
    [expiredOrg, ownerId],
  );
  await pool.query(
    "INSERT INTO subscriptions(organization_id,status,current_period_end) VALUES($1,'trialing',now()-interval '1 hour')",
    [expiredOrg],
  );

  const denied = (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === '42501';
  await assert.rejects(asAnon('SELECT run_retention_jobs()'), denied);
  await assert.rejects(asUser(ownerId, 'SELECT run_retention_jobs()'), denied);

  const first = await asService<{ result: Counts }>('SELECT run_retention_jobs() AS result');
  for (const count of [
    'expiredCount',
    'noShowCount',
    'reminderCount',
    'subscriptionExpiredCount',
    'archivedCount',
  ] as const) {
    assert.ok(first[0].result[count] >= 1, `${count} must report a committed operation`);
  }
  const states = await pool.query<{ id: string; status: string }>(
    'SELECT id,status FROM appointments WHERE id=ANY($1::uuid[])',
    [[pending, upcoming, missed, checkedIn]],
  );
  assert.equal(states.rows.find((row) => row.id === pending)?.status, 'expired');
  assert.equal(states.rows.find((row) => row.id === upcoming)?.status, 'confirmed');
  assert.equal(states.rows.find((row) => row.id === missed)?.status, 'no_show');
  assert.equal(states.rows.find((row) => row.id === checkedIn)?.status, 'checked_in');
  const archiveStates = await pool.query<{ appointment_id: string; archived: boolean }>(
    'SELECT appointment_id,archived_at IS NOT NULL AS archived FROM medical_records WHERE appointment_id=ANY($1::uuid[])',
    [[archival, held]],
  );
  assert.equal(archiveStates.rows.find((row) => row.appointment_id === archival)?.archived, true);
  assert.equal(archiveStates.rows.find((row) => row.appointment_id === held)?.archived, false);
  const reminders = await asUser<{ user_id: string; title: string; body: string }>(
    patientId,
    'SELECT user_id,title,body FROM notifications WHERE reminder_appointment_id=$1',
    [upcoming],
  );
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].user_id, patientId);
  assert.doesNotMatch(reminders[0].body, /cron-retention-fixture/);
  assert.equal(
    (await pool.query('SELECT status FROM subscriptions WHERE organization_id=$1', [expiredOrg]))
      .rows[0].status,
    'expired',
  );

  const retries = await Promise.all([
    asService<{ result: Counts }>('SELECT run_retention_jobs() AS result'),
    asService<{ result: Counts }>('SELECT run_retention_jobs() AS result'),
  ]);
  for (const retry of retries) {
    assert.deepEqual(retry[0].result, {
      expiredCount: 0,
      noShowCount: 0,
      reminderCount: 0,
      subscriptionExpiredCount: 0,
      archivedCount: 0,
    });
  }
  assert.equal(
    (await pool.query('SELECT id FROM notifications WHERE reminder_appointment_id=$1', [upcoming]))
      .rowCount,
    1,
  );
  console.log(
    'PASS cron jobs: expiry, conservative no-show, deduplicated reminders, subscription expiry, archive/legal hold, concurrent retries and grants',
  );
}
