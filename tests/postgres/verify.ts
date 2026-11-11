import pg from 'pg';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { verifyHealth } from './health.verify';
const pool = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    'postgresql://clinicbook_test:local-test-only@127.0.0.1:5432/clinicbook_verify',
  max: 55,
});
const ids = Array.from({ length: 58 }, () => randomUUID());
const [ownerA, ownerB, docA, docB, docPending, recA, patientA, patientB, ...patients] = ids;
const orgA = randomUUID(),
  orgB = randomUUID(),
  clinicA = randomUUID(),
  clinicA2 = randomUUID(),
  clinicB = randomUUID(),
  city = randomUUID(),
  spec = randomUUID();
async function asUser<T = Record<string, unknown>>(
  uid: string,
  sql: string,
  args: unknown[] = [],
  options: { rollback?: boolean } = {},
) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query('SET LOCAL ROLE authenticated');
    const r = await c.query(sql, args);
    await c.query(options.rollback ? 'ROLLBACK' : 'COMMIT');
    return r.rows as T[];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function asAnon<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claim.sub','',true)");
    await c.query('SET LOCAL ROLE anon');
    const r = await c.query(sql, args);
    await c.query('COMMIT');
    return r.rows as T[];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

async function asService<T = Record<string, unknown>>(sql: string, args: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claim.sub','',true)");
    await c.query("SELECT set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role: 'service_role' }),
    ]);
    await c.query('SET LOCAL ROLE service_role');
    const r = await c.query(sql, args);
    await c.query('COMMIT');
    return r.rows as T[];
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
async function main() {
  let inserted = false;
  const extraOrgs: string[] = [];
  const extraUsers: string[] = [];
  try {
    for (let i = 0; i < ids.length; i++)
      await pool.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [
        ids[i],
        `verify-${ids[i]}@example.test`,
        JSON.stringify({
          full_name: ids[i] === patientA ? 'سارة الخطيب' : 'Test ' + i,
        }),
      ]);
    inserted = true;
    await pool.query("UPDATE public.users SET role='clinic_owner' WHERE id=ANY($1::uuid[])", [
      [ownerA, ownerB],
    ]);
    await pool.query("UPDATE public.users SET role='doctor' WHERE id=ANY($1::uuid[])", [
      [docA, docB, docPending],
    ]);
    await pool.query("UPDATE public.users SET role='receptionist' WHERE id=$1", [recA]);
    await pool.query('INSERT INTO cities(id,name_ar,name_en,slug) VALUES($1,$2,$2,$2)', [
      city,
      'city-' + city,
    ]);
    await pool.query('INSERT INTO specialties(id,name_ar,name_en,slug) VALUES($1,$2,$2,$2)', [
      spec,
      'specialty-' + spec,
    ]);
    for (const [org, owner, clinic, doc] of [
      [orgA, ownerA, clinicA, docA],
      [orgB, ownerB, clinicB, docB],
    ]) {
      await pool.query(
        "INSERT INTO organizations(id,name,slug,owner_id,verification_status) VALUES($1,$2,$2,$3,'approved')",
        [org, 'org-' + org, owner],
      );
      await pool.query(
        "INSERT INTO subscriptions(organization_id,tier,status,max_doctors,max_clinics) VALUES($1,'clinic_pro','active',10,3)",
        [org],
      );
      await pool.query(
        "INSERT INTO clinics(id,organization_id,city_id,name,slug,district,address,phone) VALUES($1::uuid,$2,$3,'Test',$1::text,'Test','Test','123456789')",
        [clinic, org, city],
      );
      await pool.query(
        "INSERT INTO doctors(id,organization_id,specialty_id,license_number,verification_status,consultation_fee) VALUES($1::uuid,$2,$3,$1::text,'approved',25)",
        [doc, org, spec],
      );
      await pool.query(
        "INSERT INTO organization_members(organization_id,clinic_id,user_id,member_role) VALUES($1,$2,$3,'doctor')",
        [org, clinic, doc],
      );
      for (let day = 0; day < 7; day++)
        await pool.query(
          "INSERT INTO availability(doctor_id,clinic_id,day_of_week,start_time,end_time,slot_duration_minutes) VALUES($1,$2,$3,'09:00','19:00',30)",
          [doc, clinic, day],
        );
    }
    // Second branch in orgA + pending unapproved doctor for branch & directory isolation tests
    await pool.query(
      "INSERT INTO clinics(id,organization_id,city_id,name,slug,district,address,phone) VALUES($1::uuid,$2,$3,'Branch2',$1::text,'Branch2','Branch2','987654321')",
      [clinicA2, orgA, city],
    );
    await pool.query(
      "INSERT INTO doctors(id,organization_id,specialty_id,license_number,verification_status,is_listed_publicly,consultation_fee) VALUES($1::uuid,$2,$3,$1::text,'pending',false,25)",
      [docPending, orgA, spec],
    );
    await pool.query(
      "INSERT INTO organization_members(organization_id,clinic_id,user_id,member_role) VALUES($1,$2,$3,'doctor')",
      [orgA, clinicA, docPending],
    );
    await pool.query(
      "INSERT INTO organization_members(organization_id,clinic_id,user_id,member_role) VALUES($1,$2,$3,'receptionist')",
      [orgA, clinicA, recA],
    );

    await pool.query(
      "INSERT INTO organization_members(organization_id,clinic_id,user_id,member_role) VALUES($1,$2,$3,'receptionist')",
      [orgB, clinicB, ownerA],
    );
    const foreignAuditId = randomUUID();
    await pool.query(
      "INSERT INTO audit_logs(id,organization_id,actor_id,action,entity_type) VALUES($1,$2,$3,'foreign.secret','organization')",
      [foreignAuditId, orgB, ownerB],
    );
    try {
      const crossTenantFeeUpdate = await asUser<{ id: string }>(
        ownerA,
        'UPDATE doctors SET consultation_fee=1 WHERE id=$1 RETURNING id',
        [docB],
      );
      assert.equal(crossTenantFeeUpdate.length, 0);

      await assert.rejects(
        asUser(ownerA, 'SELECT replace_availability_atomic($1,$2,$3::jsonb)', [
          docB,
          clinicB,
          JSON.stringify([{ day: 1, start: '10:00', end: '12:00', duration: 30, active: true }]),
        ]),
        (e: unknown) => (e as { code: string }).code === '42501',
      );

      const foreignClinicId = randomUUID();
      await assert.rejects(
        asUser(
          ownerA,
          "INSERT INTO clinics(id,organization_id,city_id,name,slug,district,address,phone) VALUES($1,$2,$3,'Foreign',$4,'Foreign','Foreign','123456789')",
          [foreignClinicId, orgB, city, `foreign-${foreignClinicId}`],
        ),
        (e: unknown) => (e as { code: string }).code === '42501',
      );

      const foreignExceptionId = randomUUID();
      await assert.rejects(
        asUser(
          ownerA,
          "INSERT INTO availability_exceptions(id,doctor_id,clinic_id,start_at,end_at,reason,created_by) VALUES($1,$2,$3,now()+interval '10 days',now()+interval '10 days 1 hour','Foreign tenant mutation',$4)",
          [foreignExceptionId, docB, clinicB, ownerA],
        ),
        (e: unknown) => (e as { code: string }).code === '42501',
      );

      assert.equal(
        (await asUser(ownerA, 'SELECT id FROM audit_logs WHERE id=$1', [foreignAuditId])).length,
        0,
      );
    } finally {
      await pool.query('DELETE FROM organization_members WHERE organization_id=$1 AND user_id=$2', [
        orgB,
        ownerA,
      ]);
    }
    console.log(
      'PASS tenant role isolation: foreign organization membership grants no owner writes',
    );

    const scheduleRpc = 'SELECT replace_availability_atomic($1,$2,$3::jsonb)';
    const replacementShifts = [
      { day: 1, start: '09:00', end: '12:00', duration: 30, active: true },
      { day: 3, start: '13:00', end: '17:00', duration: 20, active: true },
      { day: 5, start: '09:00', end: '11:00', duration: 30, active: false },
    ];
    // A schedule row in another branch must never be collateral damage.
    await pool.query(
      "INSERT INTO availability(doctor_id,clinic_id,day_of_week,start_time,end_time,slot_duration_minutes) VALUES($1,$2,2,'08:00','10:00',30)",
      [docPending, clinicA2],
    );
    await asUser(ownerA, scheduleRpc, [docPending, clinicA, JSON.stringify(replacementShifts)]);
    const replacedSchedule = await pool.query<{
      day_of_week: number;
      slot_duration_minutes: number;
    }>(
      'SELECT day_of_week,slot_duration_minutes FROM availability WHERE doctor_id=$1 AND clinic_id=$2 ORDER BY day_of_week',
      [docPending, clinicA],
    );
    assert.deepEqual(replacedSchedule.rows, [
      { day_of_week: 1, slot_duration_minutes: 30 },
      { day_of_week: 3, slot_duration_minutes: 20 },
    ]);
    const preservedBranchSchedule = await pool.query<{
      day_of_week: number;
      slot_duration_minutes: number;
    }>(
      'SELECT day_of_week,slot_duration_minutes FROM availability WHERE doctor_id=$1 AND clinic_id=$2 ORDER BY day_of_week',
      [docPending, clinicA2],
    );
    assert.deepEqual(preservedBranchSchedule.rows, [{ day_of_week: 2, slot_duration_minutes: 30 }]);

    const overlappingShifts = [
      { day: 1, start: '09:00', end: '12:00', duration: 30, active: true },
      { day: 1, start: '11:00', end: '14:00', duration: 30, active: true },
    ];
    await assert.rejects(
      asUser(ownerA, scheduleRpc, [docPending, clinicA, JSON.stringify(overlappingShifts)]),
      (e: unknown) => (e as { code: string }).code === '22023',
    );
    assert.equal(
      (
        await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM availability WHERE doctor_id=$1 AND clinic_id=$2',
          [docPending, clinicA],
        )
      ).rows[0].n,
      2,
    );
    // An owner may not create a schedule in a branch where the doctor is not a member.
    await assert.rejects(
      asUser(ownerA, scheduleRpc, [docPending, clinicA2, JSON.stringify(replacementShifts)]),
      (e: unknown) => (e as { code: string }).code === '22023',
    );
    await assert.rejects(
      asUser(docB, scheduleRpc, [docPending, clinicA, JSON.stringify(replacementShifts)]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(docA, scheduleRpc, [docA, clinicA2, JSON.stringify(replacementShifts)]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(docA, 'DELETE FROM availability WHERE doctor_id=$1', [docA]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    console.log(
      'PASS branch-scoped availability replacement, preserved other branches, validation rollback, and tenant authorization',
    );

    const target = new Date(Date.now() + 3 * 86400000);
    target.setUTCHours(7, 0, 0, 0);
    const start = target.toISOString(),
      end = new Date(+target + 1800000).toISOString();
    const rpc = 'SELECT id FROM create_appointment_atomic($1,$2,$3,$4,$5)';
    // RED before RPC implementation; these tests exercise actual PostgreSQL, not a mock.
    const result = await Promise.all(
      patients.map((uid) =>
        asUser<{ id: string }>(uid, rpc, [uid, docA, clinicA, start, end])
          .then((r) => ({ id: r[0].id, code: '201' }))
          .catch((e) => ({ id: '', code: e.code as string })),
      ),
    );
    assert.equal(result.filter((r) => r.code === '201').length, 1);
    assert.equal(result.filter((r) => r.code === '23P01').length, patients.length - 1);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM appointments WHERE doctor_id=$1 AND start_at=$2 AND status IN ('pending','confirmed','checked_in')",
      [docA, start],
    );
    assert.equal(count.rows[0].n, 1);
    console.log(
      `PASS PostgreSQL concurrency: ${patients.length} requests, 1 success, ${patients.length - 1} exclusion violations, 0 double bookings`,
    );
    const winner = result.find((r) => r.code === '201')!;
    assert.equal(
      (await asUser(docA, 'SELECT id FROM appointments WHERE id=$1', [winner.id])).length,
      1,
    );
    assert.equal(
      (await asUser(docB, 'SELECT id FROM appointments WHERE id=$1', [winner.id])).length,
      0,
    );
    console.log('PASS RLS own doctor reads; foreign tenant cannot read');
    await assert.rejects(asUser(patientA, rpc, [patientB, docB, clinicB, start, end]));
    console.log('PASS RPC patient impersonation denied');
    const adjacentEnd = new Date(+target + 3600000).toISOString();
    await asUser(patientA, rpc, [patientA, docA, clinicA, end, adjacentEnd]);
    console.log('PASS adjacent [start,end) slots are allowed');
    const publicSlots = await asUser<{ start_at: Date }>(
      patientB,
      'SELECT * FROM get_available_slots($1,$2,$3)',
      [docA, clinicA, start.slice(0, 10)],
    );
    assert.ok(publicSlots.length > 0);
    assert.ok(!publicSlots.some((s) => new Date(s.start_at).toISOString() === start));
    console.log('PASS public slots expose only availability and exclude active holds');
    await assert.rejects(
      asUser(patientB, rpc, [
        patientB,
        docB,
        clinicB,
        start,
        new Date(+target + 3600000).toISOString(),
      ]),
    );
    console.log('PASS arbitrary duration rejected');
    await assert.rejects(
      asUser(patientB, rpc, [
        patientB,
        docB,
        clinicB,
        new Date(+target + 60000).toISOString(),
        new Date(+target + 1860000).toISOString(),
      ]),
    );
    console.log('PASS off-grid booking rejected');
    await assert.rejects(
      asUser(patientA, "UPDATE users SET role='super_admin' WHERE id=$1", [patientA]),
    );
    console.log('PASS privilege escalation denied');
    const past = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '2 days',now()-interval '2 days'+interval '30 min','completed')",
      [past, orgA, clinicA, docA, patientA],
    );
    await pool.query(
      "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'synthetic')",
      [past, orgA, docA, patientA],
    );
    assert.equal(
      (await asUser(docA, 'SELECT id FROM medical_records WHERE appointment_id=$1', [past])).length,
      1,
    );
    assert.equal(
      (await asUser(recA, 'SELECT id FROM medical_records WHERE appointment_id=$1', [past])).length,
      0,
    );
    assert.equal(
      (await asUser(ownerA, 'SELECT id FROM medical_records WHERE appointment_id=$1', [past]))
        .length,
      0,
    );
    assert.equal(
      (await asUser(patientA, 'SELECT id FROM medical_records WHERE appointment_id=$1', [past]))
        .length,
      1,
    );
    console.log('PASS EMR treating doctor/patient only; reception and owner denied');

    const retentionColumns = await pool.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='medical_records'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [['archive_reason', 'archived_at', 'archived_by', 'legal_hold', 'retention_until']],
    );
    assert.deepEqual(
      retentionColumns.rows.map((row) => row.column_name),
      ['archive_reason', 'archived_at', 'archived_by', 'legal_hold', 'retention_until'],
    );
    const medicalDeleteActions = await pool.query<{ column_name: string; delete_action: string }>(
      `SELECT kcu.column_name, rc.delete_rule AS delete_action
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema=rc.constraint_schema
        AND kcu.constraint_name=rc.constraint_name
       WHERE rc.constraint_schema='public'
         AND kcu.table_name='medical_records'
         AND kcu.column_name IN ('appointment_id','organization_id')
       ORDER BY kcu.column_name`,
    );
    assert.deepEqual(medicalDeleteActions.rows, [
      { column_name: 'appointment_id', delete_action: 'RESTRICT' },
      { column_name: 'organization_id', delete_action: 'RESTRICT' },
    ]);
    await assert.rejects(
      pool.query('DELETE FROM appointments WHERE id=$1', [past]),
      (error: unknown) => (error as { code: string }).code === '23503',
    );
    await assert.rejects(
      pool.query('DELETE FROM medical_records WHERE appointment_id=$1', [past]),
      (error: unknown) => (error as { code: string }).code === '42501',
    );
    assert.equal(
      (
        await pool.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM medical_records WHERE appointment_id=$1',
          [past],
        )
      ).rows[0].n,
      1,
    );
    console.log('PASS medical retention metadata, restrictive parents, and hard-delete guard');

    const retentionEligibleAppointment = randomUUID();
    const legalHoldAppointment = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '4 days',now()-interval '4 days'+interval '30 min','completed')",
      [retentionEligibleAppointment, orgA, clinicA, docA, patientA],
    );
    await pool.query(
      "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'retention eligible fixture')",
      [retentionEligibleAppointment, orgA, docA, patientA],
    );
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '3 days',now()-interval '3 days'+interval '30 min','completed')",
      [legalHoldAppointment, orgA, clinicA, docA, patientA],
    );
    await pool.query(
      "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'legal hold fixture')",
      [legalHoldAppointment, orgA, docA, patientA],
    );
    const retentionFixtureClient = await pool.connect();
    try {
      await retentionFixtureClient.query('BEGIN');
      await retentionFixtureClient.query("SELECT set_config('request.jwt.claims',$1,true)", [
        JSON.stringify({ role: 'service_role' }),
      ]);
      await retentionFixtureClient.query(
        `UPDATE medical_records
         SET retention_until=current_date-1,
             legal_hold=(appointment_id=$2)
         WHERE appointment_id IN ($1,$2)`,
        [retentionEligibleAppointment, legalHoldAppointment],
      );
      await retentionFixtureClient.query('COMMIT');
    } catch (error) {
      await retentionFixtureClient.query('ROLLBACK');
      throw error;
    } finally {
      retentionFixtureClient.release();
    }

    await assert.rejects(
      asUser(docA, 'SELECT archive_medical_records()'),
      (error: unknown) => (error as { code: string }).code === '42501',
    );
    const firstArchive = await asService<{ archive_medical_records: string }>(
      'SELECT archive_medical_records()',
    );
    assert.equal(Number(firstArchive[0].archive_medical_records), 1);
    const archivedStates = await pool.query<{
      appointment_id: string;
      archived: boolean;
      legal_hold: boolean;
      archive_reason: string | null;
    }>(
      `SELECT appointment_id, archived_at IS NOT NULL AS archived, legal_hold, archive_reason
       FROM medical_records
       WHERE appointment_id IN ($1,$2)
       ORDER BY appointment_id`,
      [retentionEligibleAppointment, legalHoldAppointment],
    );
    const eligibleState = archivedStates.rows.find(
      (row) => row.appointment_id === retentionEligibleAppointment,
    );
    const legalHoldState = archivedStates.rows.find(
      (row) => row.appointment_id === legalHoldAppointment,
    );
    assert.deepEqual(eligibleState, {
      appointment_id: retentionEligibleAppointment,
      archived: true,
      legal_hold: false,
      archive_reason: 'retention_period_elapsed',
    });
    assert.deepEqual(legalHoldState, {
      appointment_id: legalHoldAppointment,
      archived: false,
      legal_hold: true,
      archive_reason: null,
    });
    const retryArchive = await asService<{ archive_medical_records: string }>(
      'SELECT archive_medical_records()',
    );
    assert.equal(Number(retryArchive[0].archive_medical_records), 0);
    await assert.rejects(
      pool.query(
        "UPDATE medical_records SET diagnosis='mutated after archive' WHERE appointment_id=$1",
        [retentionEligibleAppointment],
      ),
      (error: unknown) => (error as { code: string }).code === '55000',
    );
    console.log('PASS archive-only medical retention is idempotent and honors legal holds');
    await asUser(ownerA, 'SELECT transition_appointment($1,$2,$3)', [winner.id, 'confirmed', null]);
    await assert.rejects(
      asUser(recA, 'SELECT transition_appointment($1,$2,$3)', [winner.id, 'completed', null]),
    );
    const ownerCompletionProbe = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '1 hour',now()-interval '30 minutes','confirmed')",
      [ownerCompletionProbe, orgA, clinicA, docA, patientA],
    );
    await assert.rejects(
      asUser(ownerA, 'SELECT transition_appointment($1,$2,$3)', [
        ownerCompletionProbe,
        'completed',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '22023',
    );
    await asUser(docA, 'SELECT transition_appointment($1,$2,$3)', [
      ownerCompletionProbe,
      'completed',
      null,
    ]);
    console.log('PASS lifecycle parity: owner confirms, only treating doctor completes');

    const encounterRpc =
      'SELECT save_medical_record_and_complete($1,$2,$3,$4,$5::jsonb,$6::date,$7)';
    const atomicEncounter = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '5 days',now()-interval '5 days'+interval '30 min','confirmed')",
      [atomicEncounter, orgA, clinicA, docA, patientA],
    );
    await asUser(docA, encounterRpc, [
      atomicEncounter,
      'atomic encounter diagnosis',
      'synthetic complaint',
      'synthetic note',
      JSON.stringify([{ name: 'medicine', dose: '5mg', frequency: 'daily', duration: '3 days' }]),
      '2026-11-20',
      true,
    ]);
    const committedEncounter = await asUser<{
      status: string;
      diagnosis: string;
      doctor_notes: string;
      completed: boolean;
    }>(
      docA,
      `SELECT a.status,m.diagnosis,m.doctor_notes,a.completed_at IS NOT NULL AS completed
       FROM appointments a JOIN medical_records m ON m.appointment_id=a.id
       WHERE a.id=$1`,
      [atomicEncounter],
    );
    assert.deepEqual(committedEncounter, [
      {
        status: 'completed',
        diagnosis: 'atomic encounter diagnosis',
        doctor_notes: 'synthetic note',
        completed: true,
      },
    ]);
    console.log('PASS atomic encounter save and completion commit together');

    const rollbackEncounter = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '6 days',now()-interval '6 days'+interval '30 min','confirmed')",
      [rollbackEncounter, orgA, clinicA, docA, patientA],
    );
    // Fail the INSERT after transition_appointment has run inside the RPC.
    // This proves transaction rollback, rather than just preflight rejection.
    await pool.query(
      "ALTER TABLE medical_records ADD CONSTRAINT verify_encounter_rollback CHECK(diagnosis <> 'transaction-rollback-sentinel') NOT VALID",
    );
    try {
      await assert.rejects(
        asUser(docA, encounterRpc, [
          rollbackEncounter,
          'transaction-rollback-sentinel',
          '',
          '',
          '[]',
          null,
          true,
        ]),
        (error: unknown) => (error as { code: string }).code === '23514',
      );
      const rolledBack = await pool.query<{ status: string; completed_at: Date | null }>(
        'SELECT status,completed_at FROM appointments WHERE id=$1',
        [rollbackEncounter],
      );
      assert.deepEqual(rolledBack.rows, [{ status: 'confirmed', completed_at: null }]);
      assert.equal(
        (
          await pool.query('SELECT id FROM medical_records WHERE appointment_id=$1', [
            rollbackEncounter,
          ])
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT id FROM audit_logs WHERE entity_id=$1 AND action='appointment.completed'",
            [rollbackEncounter],
          )
        ).rowCount,
        0,
      );
    } finally {
      await pool.query('ALTER TABLE medical_records DROP CONSTRAINT verify_encounter_rollback');
    }

    for (const actor of [ownerA, recA, patientA, docB]) {
      await assert.rejects(
        asUser(actor, encounterRpc, [
          rollbackEncounter,
          'unauthorized encounter',
          '',
          '',
          '[]',
          null,
          true,
        ]),
        (error: unknown) => (error as { code: string }).code === '42501',
      );
    }
    await assert.rejects(
      asUser(
        docA,
        "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'bypass')",
        [rollbackEncounter, orgA, docA, patientA],
      ),
      (error: unknown) => (error as { code: string }).code === '42501',
    );

    const raceEncounter = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '7 days',now()-interval '7 days'+interval '30 min','confirmed')",
      [raceEncounter, orgA, clinicA, docA, patientA],
    );
    await Promise.all(
      ['concurrent diagnosis one', 'concurrent diagnosis two'].map((diagnosis) =>
        asUser(docA, encounterRpc, [raceEncounter, diagnosis, '', '', '[]', null, true]),
      ),
    );
    const concurrentEncounter = await pool.query<{ status: string; n: number }>(
      `SELECT a.status,count(m.id)::int AS n FROM appointments a
       LEFT JOIN medical_records m ON m.appointment_id=a.id
       WHERE a.id=$1 GROUP BY a.status`,
      [raceEncounter],
    );
    assert.deepEqual(concurrentEncounter.rows, [{ status: 'completed', n: 1 }]);
    console.log(
      'PASS encounter rollback, actor authorization, direct-write denial, and concurrent saves',
    );
    const review = await asUser(
      patientA,
      'INSERT INTO reviews(appointment_id,doctor_id,patient_id,rating) VALUES($1,$2,$3,5) RETURNING id',
      [past, docA, patientA],
    );
    assert.equal(review.length, 1);
    await assert.rejects(
      asUser(
        patientB,
        'INSERT INTO reviews(appointment_id,doctor_id,patient_id,rating) VALUES($1,$2,$3,5)',
        [past, docA, patientB],
      ),
    );
    console.log('PASS verified review ownership');
    const futureStarts = [2, 3, 4].map((n) => new Date(+target + n * 1800000).toISOString());
    for (let i = 0; i < 2; i++)
      await asUser(patientA, rpc, [
        patientA,
        docA,
        clinicA,
        futureStarts[i],
        new Date(+target + (i + 3) * 1800000).toISOString(),
      ]);
    await assert.rejects(
      asUser(patientA, rpc, [
        patientA,
        docA,
        clinicA,
        futureStarts[2],
        new Date(+target + 5 * 1800000).toISOString(),
      ]),
      (e: unknown) => (e as { code: string }).code === 'P0006',
    );
    console.log('PASS maximum three active bookings enforced');

    // ─── P0-2: Staff Atomic Booking RPC Acceptance Tests ─────────────────
    const dayPlus4 = new Date(Date.now() + 4 * 86400000);
    dayPlus4.setUTCHours(7, 0, 0, 0);
    const staffRpc =
      'SELECT id, booking_source, walk_in_patient_name FROM create_staff_appointment_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9)';

    // Outside working hours (21:00 UTC = 00:00 Damascus next day, outside 09:00-19:00)
    const outsideStart = new Date(dayPlus4);
    outsideStart.setUTCHours(21, 0, 0, 0);
    const outsideEnd = new Date(+outsideStart + 1800000);
    await assert.rejects(
      asUser(recA, staffRpc, [
        docA,
        clinicA,
        outsideStart.toISOString(),
        outsideEnd.toISOString(),
        'walk_in',
        null,
        'زائر خارج الدوام',
        '+963991112233',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '22023',
    );

    // Inside availability exception
    const excStart = new Date(dayPlus4);
    excStart.setUTCHours(10, 0, 0, 0);
    const excEnd = new Date(+excStart + 3600000);
    await asUser(
      docA,
      'INSERT INTO availability_exceptions(doctor_id,clinic_id,start_at,end_at,reason,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [docA, clinicA, excStart.toISOString(), excEnd.toISOString(), 'إجازة مؤتمر', docA],
    );
    await assert.rejects(
      asUser(recA, staffRpc, [
        docA,
        clinicA,
        excStart.toISOString(),
        new Date(+excStart + 1800000).toISOString(),
        'walk_in',
        null,
        'زائر استثناء',
        '+963991112244',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '22023',
    );

    // Before min_lead_minutes (60 mins default) -> P0004
    const soonStart = new Date(Date.now() + 10 * 60000);
    const soonEnd = new Date(+soonStart + 1800000);
    await assert.rejects(
      asUser(recA, staffRpc, [
        docA,
        clinicA,
        soonStart.toISOString(),
        soonEnd.toISOString(),
        'walk_in',
        null,
        'زائر عاجل',
        '+963991112255',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === 'P0004',
    );

    // Concurrent staff booking race on dayPlus4 07:00 UTC -> exactly 1 succeeds
    const staffRaceStart = dayPlus4.toISOString();
    const staffRaceEnd = new Date(+dayPlus4 + 1800000).toISOString();
    const staffRace = await Promise.all(
      Array.from({ length: 10 }, (_, idx) =>
        asUser(recA, staffRpc, [
          docA,
          clinicA,
          staffRaceStart,
          staffRaceEnd,
          'walk_in',
          null,
          `مراجع متزامن ${idx}`,
          `+9639900000${idx}`,
          null,
        ])
          .then(() => '201')
          .catch((e) => (e as { code: string }).code),
      ),
    );
    assert.equal(staffRace.filter((c) => c === '201').length, 1);
    assert.equal(staffRace.filter((c) => c === '23P01').length, 9);

    // Walk-in creates NO new auth.users row
    const authCountBefore = Number(
      (await pool.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n,
    );
    const walkInStart = new Date(+dayPlus4 + 1800000).toISOString();
    const walkInEnd = new Date(+dayPlus4 + 3600000).toISOString();
    const walkInRows = await asUser<{ booking_source: string; walk_in_patient_name: string }>(
      recA,
      staffRpc,
      [
        docA,
        clinicA,
        walkInStart,
        walkInEnd,
        'walk_in',
        null,
        'مراجع مباشر',
        '+963991122334',
        null,
      ],
    );
    assert.equal(walkInRows[0].booking_source, 'reception_desk');
    assert.equal(walkInRows[0].walk_in_patient_name, 'مراجع مباشر');
    // Registered patient matching via verified phone inside create_staff_appointment_atomic
    const matchedPhone = `+96399${docA.replace(/-/g, '').slice(0, 7)}`;
    await pool.query('UPDATE public.users SET phone=$1 WHERE id=$2', [matchedPhone, patientB]);
    const matchedRows = await asUser<{
      id: string;
      booking_source: string;
      walk_in_patient_name: string | null;
    }>(recA, staffRpc, [
      docA,
      clinicA,
      new Date(+dayPlus4 + 5400000).toISOString(),
      new Date(+dayPlus4 + 7200000).toISOString(),
      'first_visit',
      null,
      null,
      matchedPhone,
      null,
    ]);
    assert.equal(matchedRows[0].walk_in_patient_name, null);
    const matchedApptRow = (
      await pool.query('SELECT patient_id FROM appointments WHERE id=$1', [matchedRows[0].id])
    ).rows[0] as { patient_id: string | null };
    assert.equal(matchedApptRow.patient_id, patientB);

    const authCountAfter = Number(
      (await pool.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n,
    );
    assert.equal(authCountAfter, authCountBefore);

    // Receptionist denied on other org AND other branch within same org
    await assert.rejects(
      asUser(recA, staffRpc, [
        docB,
        clinicB,
        walkInStart,
        walkInEnd,
        'walk_in',
        null,
        'مراجع فرع أجنبي',
        '+963991122335',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(recA, staffRpc, [
        docA,
        clinicA2,
        walkInStart,
        walkInEnd,
        'walk_in',
        null,
        'مراجع فرع ثان',
        '+963991122336',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );

    // Patient denied calling create_staff_appointment_atomic
    await assert.rejects(
      asUser(patientA, staffRpc, [
        docA,
        clinicA,
        new Date(+dayPlus4 + 3600000).toISOString(),
        new Date(+dayPlus4 + 5400000).toISOString(),
        'walk_in',
        null,
        'مريض متطفل',
        '+963991122337',
        null,
      ]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    console.log(
      'PASS P0-2: staff atomic RPC rejects outside-hours/exception/lead-time, prevents race & walk-in auth creation, resolves phone cleanly, enforces branch/role isolation',
    );

    // ─── P0-3: Hardened Directory, Team & Review RPCs ─────────────────
    await pool.query('UPDATE subscriptions SET booking_horizon_days=120 WHERE organization_id=$1', [
      orgA,
    ]);
    await pool.query('UPDATE clinics SET cancel_window_hours=12 WHERE id=$1', [clinicA]);
    await pool.query('UPDATE clinics SET cancel_window_hours=24 WHERE id=$1', [clinicA2]);
    await pool.query(
      'UPDATE organization_members SET clinic_id=$1 WHERE organization_id=$2 AND user_id=$3',
      [clinicA2, orgA, docA],
    );
    const anonDocs = await asAnon<Record<string, unknown>>(
      'SELECT * FROM public_doctor_directory()',
    );
    const publicDocA = anonDocs.find((d) => d.id === docA);
    assert.ok(publicDocA);
    assert.equal(publicDocA.clinic_id, clinicA2);
    assert.equal(publicDocA.booking_horizon_days, 120);
    assert.equal(publicDocA.cancel_window_hours, 24);
    assert.ok(!anonDocs.some((d) => d.id === docPending));
    assert.ok(!('email' in anonDocs[0]) && !('phone' in anonDocs[0]) && !('role' in anonDocs[0]));

    await assert.rejects(
      asAnon('SELECT id, email FROM public.users LIMIT 1'),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asAnon('SELECT patient_id FROM public.reviews LIMIT 1'),
      (e: unknown) => (e as { code: string }).code === '42501',
    );

    // Cross-doctor email isolation & team_directory scoping
    assert.equal(
      (await asUser(docA, 'SELECT email FROM public.users WHERE id=$1', [docB])).length,
      0,
    );
    await assert.rejects(
      asUser(docA, 'SELECT * FROM team_directory($1)', [orgB]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    const orgATeam = await asUser<{ id: string }>(docA, 'SELECT * FROM team_directory($1)', [orgA]);
    assert.ok(orgATeam.some((m) => m.id === docA));

    // Published review masks surname & collapses repeated whitespace
    await pool.query("UPDATE public.users SET full_name='سارة   الخطيب' WHERE id=$1", [patientA]);
    const anonReviews = await asAnon<{ display_name: string }>('SELECT * FROM public_reviews($1)', [
      docA,
    ]);
    assert.ok(anonReviews.length >= 1);
    assert.ok(!anonReviews.some((r) => r.display_name.includes('الخطيب')));
    assert.ok(anonReviews.some((r) => r.display_name === 'سارة ا.'));
    console.log('PASS P0-3: public directory/reviews masked & scoped; users/cross-team isolated');

    // ─── P1-1: Privilege & RLS Separation Without Service Role ────────
    await assert.rejects(
      asUser(recA, "UPDATE appointments SET status='completed' WHERE id=$1", [winner.id]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    // Use a valid past completed encounter so BEFORE INSERT validate_medical_record() passes and RLS WITH CHECK rejects non-treating roles with 42501
    const past2 = randomUUID();
    await pool.query(
      "INSERT INTO appointments(id,organization_id,clinic_id,doctor_id,patient_id,start_at,end_at,status) VALUES($1,$2,$3,$4,$5,now()-interval '1 day',now()-interval '1 day'+interval '30 min','completed')",
      [past2, orgA, clinicA, docA, patientA],
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'hack')",
        [past2, orgA, docA, patientA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        ownerA,
        "INSERT INTO medical_records(appointment_id,organization_id,doctor_id,patient_id,diagnosis) VALUES($1,$2,$3,$4,'hack')",
        [past2, orgA, docA, patientA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        patientA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES(NULL,$1,'spoof','system',$1)",
        [patientA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        ownerA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'subscription.activated','organization',$1)",
        [orgA, ownerA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'billing.requested','organization',$1,'{\"requested_tier\":\"enterprise\"}'::jsonb)",
        [orgA, recA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        ownerA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'medical.saved','medical_record',$3)",
        [orgA, ownerA, past],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'doctor.fee_updated','doctor',$3)",
        [orgA, recA, docA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'branch.created','clinic',$3)",
        [orgA, recA, clinicA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'organization.updated','organization',$1)",
        [orgA, recA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'exception.created','availability_exception',$3)",
        [orgA, recA, randomUUID()],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        recA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'payment.cash','appointment',$3)",
        [orgA, recA, randomUUID()],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    await assert.rejects(
      asUser(
        ownerA,
        "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'organization.updated','organization',$1)",
        [orgA, ownerA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
      'Even an owner cannot claim a mutation happened by writing an audit row directly',
    );
    // Under PostgreSQL RLS, non-owner UPDATE on granted column (name) filters out rows via USING (0 rows updated), while non-granted columns throw 42501.
    const hijackRows = await asUser<{ id: string }>(
      docA,
      "UPDATE organizations SET name='hijacked' WHERE id=$1 RETURNING id",
      [orgA],
    );
    assert.equal(hijackRows.length, 0);
    await assert.rejects(
      asUser(docA, "UPDATE organizations SET verification_status='rejected' WHERE id=$1", [orgA]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    const orgRow = (await pool.query('SELECT name FROM organizations WHERE id=$1', [orgA]))
      .rows[0] as { name: string };
    assert.equal(orgRow.name, 'org-' + orgA);

    await asUser(ownerA, 'UPDATE doctors SET consultation_fee=26 WHERE id=$1', [docA]);
    const feeAudit = await asUser<{
      actor_id: string;
      metadata: { operation: string; changed_fields: string[] };
    }>(
      ownerA,
      "SELECT actor_id, metadata FROM audit_logs WHERE organization_id=$1 AND entity_id=$2 AND action='doctor.fee_updated' ORDER BY created_at DESC LIMIT 1",
      [orgA, docA],
    );
    assert.equal(feeAudit.length, 1, 'A committed fee mutation must create its audit event');
    assert.equal(feeAudit[0].actor_id, ownerA);
    assert.deepEqual(feeAudit[0].metadata, {
      operation: 'UPDATE',
      changed_fields: ['consultation_fee'],
    });

    await asUser(ownerA, "UPDATE clinics SET phone='private-phone-sentinel' WHERE id=$1", [
      clinicA,
    ]);
    await asUser(recA, "UPDATE appointments SET payment_status='paid_cash' WHERE id=$1", [
      winner.id,
    ]);
    await asUser(docA, encounterRpc, [
      past,
      'synthetic',
      '',
      'private-clinical-sentinel',
      '[]',
      null,
      true,
    ]);
    const committedAudit = await asUser<{ action: string; actor_id: string; metadata: unknown }>(
      ownerA,
      "SELECT action, actor_id, metadata FROM audit_logs WHERE organization_id=$1 AND source='database'",
      [orgA],
    );
    assert.ok(committedAudit.some((r) => r.action === 'clinic.updated' && r.actor_id === ownerA));
    assert.ok(committedAudit.some((r) => r.action === 'payment.cash' && r.actor_id === recA));
    assert.ok(committedAudit.some((r) => r.action === 'medical.saved' && r.actor_id === docA));
    for (const action of [
      'organization.created',
      'subscription.activated',
      'team.member_added',
      'availability.insert',
      'exception.created',
      'review.created',
    ]) {
      assert.ok(
        committedAudit.some((r) => r.action === action),
        `Missing database audit: ${action}`,
      );
    }
    assert.ok(!JSON.stringify(committedAudit).includes('private-phone-sentinel'));
    assert.ok(!JSON.stringify(committedAudit).includes('private-clinical-sentinel'));
    const auditCountBeforeRollback = committedAudit.length;
    await asUser(ownerA, "UPDATE clinics SET phone='rolled-back-value' WHERE id=$1", [clinicA], {
      rollback: true,
    });
    assert.equal(
      (
        await asUser(
          ownerA,
          "SELECT id FROM audit_logs WHERE organization_id=$1 AND source='database'",
          [orgA],
        )
      ).length,
      auditCountBeforeRollback,
      'Rolled-back mutations cannot leave committed audit evidence',
    );
    console.log(
      'PASS database audit: committed mutations are recorded without copying private values',
    );
    console.log(
      'PASS P1-1: direct appointment status mutation, non-doctor EMR insert, null-org audit spoof, and non-owner org rename denied',
    );

    // ─── REM-01 / REM-02 / REM-03: Audit Remediation RPCs ──────────────
    const superAdminId = randomUUID();
    const freshOwnerId = randomUUID();
    const freshDoctorId = randomUUID();
    const provisionedMemberId = randomUUID();
    extraUsers.push(superAdminId, freshOwnerId, freshDoctorId, provisionedMemberId);

    for (const uid of [superAdminId, freshOwnerId, freshDoctorId, provisionedMemberId]) {
      await pool.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [
        uid,
        `rem-${uid}@example.test`,
        JSON.stringify({ full_name: 'Audit User' }),
      ]);
    }
    await pool.query("UPDATE public.users SET role='super_admin' WHERE id=$1", [superAdminId]);

    // 1. tenant_doctors_directory includes pending doctors for orgA members, denies orgB
    const orgADoctors = await asUser<{ id: string; verification_status: string }>(
      ownerA,
      'SELECT * FROM tenant_doctors_directory($1)',
      [orgA],
    );
    assert.ok(orgADoctors.some((d) => d.id === docA && d.verification_status === 'approved'));
    assert.ok(orgADoctors.some((d) => d.id === docPending && d.verification_status === 'pending'));
    await assert.rejects(
      asUser(ownerB, 'SELECT * FROM tenant_doctors_directory($1)', [orgA]),
      (e: unknown) => (e as { code: string }).code === '42501',
    );

    // 2. super_admin_dashboard_data allowed strictly for super_admin, contains governance only
    await assert.rejects(
      asUser(ownerA, 'SELECT super_admin_dashboard_data()'),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    const adminDashRows = await asUser<{ super_admin_dashboard_data: Record<string, unknown> }>(
      superAdminId,
      'SELECT super_admin_dashboard_data()',
    );
    const adminSnap = adminDashRows[0].super_admin_dashboard_data as {
      organizations: Array<{ id: string }>;
      verifications: Array<{ id: string }>;
      appointments?: unknown;
      medical_records?: unknown;
    };
    assert.ok(adminSnap.organizations.some((o) => o.id === orgA));
    assert.ok(adminSnap.verifications.some((v) => v.id === docPending));
    assert.equal(adminSnap.appointments, undefined);
    assert.equal(adminSnap.medical_records, undefined);

    await assert.rejects(
      asUser(ownerA, 'SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7)', [
        ownerA,
        orgA,
        clinicA,
        patientB,
        `verify-${patientB}@example.test`,
        'Overwritten account',
        'receptionist',
      ]),
      (e: unknown) => (e as { code: string }).code === '42501',
      'A tenant cannot call privileged provisioning directly with another account ID',
    );
    await assert.rejects(
      asService('SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7)', [
        ownerA,
        orgA,
        clinicA,
        patientB,
        `verify-${patientB}@example.test`,
        'Overwritten account',
        'receptionist',
      ]),
      (e: unknown) => (e as { code: string }).code === '42501',
      'Trusted provisioning also rejects an existing account that is not its own pending invitation',
    );
    await assert.rejects(
      asService(
        'SELECT * FROM onboard_organization_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          freshOwnerId,
          `rem-${freshOwnerId}@example.test`,
          'New owner',
          'Invalid onboarding',
          'city-' + city,
          'District',
          '011-4455667',
          `INVALID-${freshOwnerId}`,
          'solo_starter',
          patientB,
          `verify-${patientB}@example.test`,
          'Overwritten patient',
        ],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
      'Onboarding must not turn an unrelated existing user into its initial doctor',
    );

    // 3. onboard_organization_atomic creates org, clinic, owner role & separate doctor atomically
    await pool.query(
      'UPDATE auth.users SET invited_at=now(), raw_user_meta_data=raw_user_meta_data || $2::jsonb WHERE id=$1',
      [
        freshDoctorId,
        JSON.stringify({ invited_by: freshOwnerId, invitation_purpose: 'clinic_onboarding' }),
      ],
    );
    await assert.rejects(
      asService(
        'SELECT * FROM onboard_organization_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          freshOwnerId,
          `rem-${freshOwnerId}@example.test`,
          'New owner',
          'Unapproved Pro trial',
          'city-' + city,
          'District',
          '011-4455667',
          `PRO-${freshOwnerId}`,
          'clinic_pro',
          freshDoctorId,
          `rem-${freshDoctorId}@example.test`,
          'New doctor',
        ],
      ),
      (e: unknown) => (e as { code: string }).code === 'P0008',
      'Onboarding entitlements are Starter-only even through the trusted RPC',
    );
    const onboardedRows = await asService<{ organization_id: string; clinic_id: string }>(
      'SELECT * FROM onboard_organization_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [
        freshOwnerId,
        `rem-${freshOwnerId}@example.test`,
        'مالك المركز الجديد',
        'مركز الشام التخصصي',
        'city-' + city,
        'المزة',
        '011-4455667',
        `LIC-${freshOwnerId.slice(0, 8)}`,
        'solo_starter',
        freshDoctorId,
        `rem-${freshDoctorId}@example.test`,
        'سامر الحلبي',
      ],
    );
    assert.equal(onboardedRows.length, 1);
    const newOrgId = onboardedRows[0].organization_id;
    const newClinicId = onboardedRows[0].clinic_id;
    extraOrgs.push(newOrgId);
    const initialSubscription = await asUser<{
      tier: string;
      status: string;
      max_doctors: number;
      max_clinics: number;
    }>(
      freshOwnerId,
      'SELECT tier,status,max_doctors,max_clinics FROM subscriptions WHERE organization_id=$1',
      [newOrgId],
    );
    assert.deepEqual(initialSubscription[0], {
      tier: 'solo_starter',
      status: 'trialing',
      max_doctors: 1,
      max_clinics: 1,
    });

    // Duplicate onboarding rejected with 23505
    await assert.rejects(
      asService(
        'SELECT * FROM onboard_organization_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          freshOwnerId,
          `rem-${freshOwnerId}@example.test`,
          'مالك المركز الجديد',
          'مركز مكرر',
          'دمشق',
          'المزة',
          '011-4455667',
          `LIC-DUP-${freshOwnerId.slice(0, 6)}`,
          'solo_starter',
          null,
          null,
          null,
        ],
      ),
      (e: unknown) => (e as { code: string }).code === '23505',
    );

    // 4. provision_team_member_atomic provisions staff & enforces solo_starter receptionist block
    await pool.query(
      'UPDATE auth.users SET invited_at=now(), raw_user_meta_data=raw_user_meta_data || $2::jsonb WHERE id=$1',
      [
        provisionedMemberId,
        JSON.stringify({
          invited_by: freshOwnerId,
          invitation_purpose: 'team_member',
          organization_id: newOrgId,
        }),
      ],
    );
    await assert.rejects(
      asService('SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7)', [
        freshOwnerId,
        newOrgId,
        newClinicId,
        provisionedMemberId,
        `rem-${provisionedMemberId}@example.test`,
        'New receptionist',
        'receptionist',
      ]),
      (e: unknown) => (e as { code: string }).code === 'P0008',
    );
    await assert.rejects(
      asService('SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
        freshOwnerId,
        newOrgId,
        newClinicId,
        provisionedMemberId,
        `rem-${provisionedMemberId}@example.test`,
        'Second Starter doctor',
        'doctor',
        'الطب العام',
        35,
        `LIMIT-${provisionedMemberId}`,
      ]),
      (e: unknown) => (e as { code: string }).code === 'P0009',
    );
    // Only an administrator can activate the tier needed to add more staff.
    await pool.query(
      "UPDATE subscriptions SET tier='clinic_pro', status='active', max_doctors=10, max_clinics=3, current_period_end=now()+interval '30 days' WHERE organization_id=$1",
      [newOrgId],
    );
    const provRows = await asService<{ provision_team_member_atomic: string }>(
      'SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [
        freshOwnerId,
        newOrgId,
        newClinicId,
        provisionedMemberId,
        `rem-${provisionedMemberId}@example.test`,
        'د. طارق منصور',
        'doctor',
        'الطب العام',
        35,
        `LIC-TEAM-${provisionedMemberId.slice(0, 8)}`,
      ],
    );
    assert.equal(provRows[0].provision_team_member_atomic, provisionedMemberId);
    const roleAudit = await asUser<{ metadata: { changed_fields: string[] } }>(
      superAdminId,
      "SELECT metadata FROM audit_logs WHERE entity_id=$1 AND action='user.update' AND source='database'",
      [provisionedMemberId],
    );
    assert.ok(roleAudit.some((r) => r.metadata.changed_fields.includes('role')));

    const competingDoctors = [randomUUID(), randomUUID()];
    extraUsers.push(...competingDoctors);
    for (const id of competingDoctors) {
      await pool.query(
        'INSERT INTO auth.users(id,email,raw_user_meta_data,invited_at) VALUES($1,$2,$3,now())',
        [
          id,
          `race-${id}@example.test`,
          JSON.stringify({
            invited_by: freshOwnerId,
            invitation_purpose: 'team_member',
            organization_id: newOrgId,
          }),
        ],
      );
    }
    await pool.query('UPDATE subscriptions SET max_doctors=3 WHERE organization_id=$1', [newOrgId]);
    const provisioningRace = await Promise.all(
      competingDoctors.map((id) =>
        asService('SELECT provision_team_member_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
          freshOwnerId,
          newOrgId,
          newClinicId,
          id,
          `race-${id}@example.test`,
          'Concurrent doctor',
          'doctor',
          'الطب العام',
          35,
          `RACE-${id}`,
        ])
          .then(() => 'OK')
          .catch((e: { code: string }) => e.code),
      ),
    );
    assert.equal(provisioningRace.filter((code) => code === 'OK').length, 1);
    assert.equal(provisioningRace.filter((code) => code === 'P0009').length, 1);
    assert.equal(
      (await asUser(freshOwnerId, 'SELECT id FROM doctors WHERE organization_id=$1', [newOrgId]))
        .length,
      3,
      'Concurrent provisioning cannot exceed the actual subscription limit',
    );

    const claimedInvitationCleanup = await asService<{ discarded: boolean }>(
      'SELECT discard_pending_invitation($1,$2,$3,$4,$5) AS discarded',
      [
        provisionedMemberId,
        `rem-${provisionedMemberId}@example.test`,
        freshOwnerId,
        'team_member',
        newOrgId,
      ],
    );
    assert.equal(claimedInvitationCleanup[0].discarded, false);
    assert.equal(
      (await asUser(provisionedMemberId, 'SELECT id FROM users WHERE id=$1', [provisionedMemberId]))
        .length,
      1,
      'Rollback cannot delete an invitation that has already become a real team member',
    );
    const unusedInvitationId = randomUUID();
    const signedInInvitationId = randomUUID();
    extraUsers.push(unusedInvitationId, signedInInvitationId);
    for (const id of [unusedInvitationId, signedInInvitationId]) {
      await pool.query(
        'INSERT INTO auth.users(id,email,raw_user_meta_data,invited_at,last_sign_in_at) VALUES($1,$2,$3,now(),$4)',
        [
          id,
          `invite-${id}@example.test`,
          JSON.stringify({
            invited_by: freshOwnerId,
            invitation_purpose: 'team_member',
            organization_id: newOrgId,
          }),
          id === signedInInvitationId ? new Date() : null,
        ],
      );
    }
    const cleanupAfterSignIn = await asService<{ discarded: boolean }>(
      'SELECT discard_pending_invitation($1,$2,$3,$4,$5) AS discarded',
      [
        signedInInvitationId,
        `invite-${signedInInvitationId}@example.test`,
        freshOwnerId,
        'team_member',
        newOrgId,
      ],
    );
    assert.equal(cleanupAfterSignIn[0].discarded, false);
    const cleanupPending = await asService<{ discarded: boolean }>(
      'SELECT discard_pending_invitation($1,$2,$3,$4,$5) AS discarded',
      [
        unusedInvitationId,
        `invite-${unusedInvitationId}@example.test`,
        freshOwnerId,
        'team_member',
        newOrgId,
      ],
    );
    assert.equal(cleanupPending[0].discarded, true);
    assert.equal(
      (await asUser(unusedInvitationId, 'SELECT id FROM users WHERE id=$1', [unusedInvitationId]))
        .length,
      0,
    );
    console.log(
      'PASS provisioning: only scoped unused invitations can be claimed or safely discarded',
    );

    // 5. tenant_billing_requests tracks pending -> approved lifecycle
    for (const actor of [recA, ownerB]) {
      await assert.rejects(
        asUser(actor, 'SELECT request_billing_upgrade($1,$2)', [orgA, 'enterprise']),
        (e: unknown) => (e as { code: string }).code === '42501',
      );
    }
    await asUser(ownerA, 'SELECT request_billing_upgrade($1,$2)', [orgA, 'enterprise']);
    await assert.rejects(
      asUser(ownerA, 'SELECT request_billing_upgrade($1,$2)', [orgA, 'enterprise']),
      (e: unknown) => (e as { code: string }).code === '23505',
    );
    await assert.rejects(
      asUser(
        ownerA,
        "UPDATE billing_requests SET status='approved', resolved_at=now() WHERE organization_id=$1",
        [orgA],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    );
    const billingReqs = await asUser<{ tier: string; status: string }>(
      ownerA,
      'SELECT * FROM tenant_billing_requests($1)',
      [orgA],
    );
    assert.ok(billingReqs.some((r) => r.tier === 'enterprise' && r.status === 'pending'));

    await pool.query(
      "INSERT INTO audit_logs(organization_id,actor_id,action,entity_type,entity_id) VALUES($1,$2,'subscription.activated','organization',$1)",
      [orgA, ownerA],
    );
    const afterLegacyEvent = await asUser<{ tier: string; status: string }>(
      ownerA,
      'SELECT * FROM tenant_billing_requests($1)',
      [orgA],
    );
    assert.ok(afterLegacyEvent.some((r) => r.tier === 'enterprise' && r.status === 'pending'));

    await pool.query(
      "UPDATE subscriptions SET tier='enterprise', status='active', max_doctors=100, max_clinics=100, current_period_end=now()+interval '30 days' WHERE organization_id=$1",
      [orgA],
    );
    const approvedBilling = await asUser<{ tier: string; status: string }>(
      ownerA,
      'SELECT * FROM tenant_billing_requests($1)',
      [orgA],
    );
    assert.ok(
      approvedBilling.some((r) => r.tier === 'enterprise' && r.status === 'approved'),
      'Only a real active subscription to the requested tier approves a billing request',
    );

    // 6. Verify 100% of public SECURITY DEFINER functions enforce pg_temp in search_path
    const unsafeDefiners = await pool.query<{ proname: string }>(
      `SELECT p.proname
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef = true
         AND NOT EXISTS (
           SELECT 1
           FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg
           WHERE cfg ILIKE 'search_path=%pg_temp%'
         )`,
    );
    assert.deepEqual(
      unsafeDefiners.rows.map((r) => r.proname),
      [],
      'All public SECURITY DEFINER functions must include pg_temp in search_path',
    );
    console.log(
      'PASS REM-01..03 & REM-V2-05: atomic/governance RPCs and 100% SECURITY DEFINER pg_temp hardening verified',
    );
    await verifyHealth(pool, asService, asUser, asAnon);
  } finally {
    if (inserted) {
      const allUsers = [...ids, ...extraUsers];
      // A deliberately failing exploit may have created an organization before
      // an assertion rejects it. Cleanup remains scoped to these test identities.
      const ownedTestOrgs = await pool.query<{ id: string }>(
        'SELECT id FROM organizations WHERE owner_id=ANY($1::uuid[])',
        [allUsers],
      );
      const allOrgs = [
        ...new Set([orgA, orgB, ...extraOrgs, ...ownedTestOrgs.rows.map((r) => r.id)]),
      ];
      await pool.query('DELETE FROM reviews WHERE doctor_id=ANY($1::uuid[])', [
        [docA, docB, docPending],
      ]);
      // Local fixture teardown is the only hard-purge path. Production
      // operations archive records and never set this database-owner override.
      await pool.query("SELECT set_config('clinicbook.allow_medical_purge','on',false)");
      await pool.query('DELETE FROM medical_records WHERE organization_id=ANY($1::uuid[])', [
        allOrgs,
      ]);
      await pool.query('DELETE FROM availability_exceptions WHERE doctor_id=ANY($1::uuid[])', [
        [docA, docB, docPending],
      ]);
      await pool.query('DELETE FROM audit_logs WHERE organization_id=ANY($1::uuid[])', [allOrgs]);
      await pool.query('DELETE FROM appointments WHERE organization_id=ANY($1::uuid[])', [allOrgs]);
      await pool.query('DELETE FROM organizations WHERE id=ANY($1::uuid[])', [allOrgs]);
      await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [allUsers]);
      await pool.query('DELETE FROM cities WHERE id=$1', [city]);
      await pool.query('DELETE FROM specialties WHERE id=$1', [spec]);
    }
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
