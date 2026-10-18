import pg from 'pg';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const pool = new pg.Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    'postgresql://clinicbook_test:local-test-only@127.0.0.1:5432/clinicbook_verify',
  max: 55,
});
const ids = Array.from({ length: 57 }, () => randomUUID());
const [ownerA, ownerB, docA, docB, recA, patientA, patientB, ...patients] = ids;
const orgA = randomUUID(),
  orgB = randomUUID(),
  clinicA = randomUUID(),
  clinicB = randomUUID(),
  city = randomUUID(),
  spec = randomUUID();
async function asUser<T = Record<string, unknown>>(uid: string, sql: string, args: unknown[] = []) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [uid]);
    await c.query('SET LOCAL ROLE authenticated');
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
  try {
    for (let i = 0; i < ids.length; i++)
      await pool.query('INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES($1,$2,$3)', [
        ids[i],
        `verify-${ids[i]}@example.test`,
        JSON.stringify({ full_name: 'Test ' + i }),
      ]);
    inserted = true;
    await pool.query("UPDATE public.users SET role='clinic_owner' WHERE id=ANY($1::uuid[])", [
      [ownerA, ownerB],
    ]);
    await pool.query("UPDATE public.users SET role='doctor' WHERE id=ANY($1::uuid[])", [
      [docA, docB],
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
        "INSERT INTO subscriptions(organization_id,tier,status,max_doctors) VALUES($1,'clinic_pro','active',10)",
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
    await pool.query(
      "INSERT INTO organization_members(organization_id,clinic_id,user_id,member_role) VALUES($1,$2,$3,'receptionist')",
      [orgA, clinicA, recA],
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
    assert.equal(result.filter((r) => r.code === '23P01').length, 49);
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM appointments WHERE doctor_id=$1 AND start_at=$2 AND status IN ('pending','confirmed','checked_in')",
      [docA, start],
    );
    assert.equal(count.rows[0].n, 1);
    console.log(
      'PASS PostgreSQL concurrency: 50 requests, 1 success, 49 exclusion violations, 0 double bookings',
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
    await asUser(docA, 'SELECT transition_appointment($1,$2,$3)', [winner.id, 'confirmed', null]);
    await assert.rejects(
      asUser(recA, 'SELECT transition_appointment($1,$2,$3)', [winner.id, 'completed', null]),
    );
    console.log('PASS lifecycle role checks');
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
  } finally {
    if (inserted) {
      await pool.query('DELETE FROM medical_records WHERE organization_id=ANY($1::uuid[])', [
        [orgA, orgB],
      ]);
      await pool.query('DELETE FROM appointments WHERE organization_id=ANY($1::uuid[])', [
        [orgA, orgB],
      ]);
      await pool.query('DELETE FROM organizations WHERE id=ANY($1::uuid[])', [[orgA, orgB]]);
      await pool.query('DELETE FROM auth.users WHERE id=ANY($1::uuid[])', [ids]);
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
