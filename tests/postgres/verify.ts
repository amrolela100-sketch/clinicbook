import pg from 'pg';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
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
async function main() {
  let inserted = false;
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
    const anonDocs = await asAnon<Record<string, unknown>>(
      'SELECT * FROM public_doctor_directory()',
    );
    assert.ok(anonDocs.some((d) => d.id === docA));
    assert.ok(!anonDocs.some((d) => d.id === docPending));
    assert.ok(!('email' in anonDocs[0]) && !('phone' in anonDocs[0]) && !('role' in anonDocs[0]));

    await assert.rejects(
      asAnon('SELECT id, email FROM public.users LIMIT 1'),
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
    console.log(
      'PASS P1-1: direct appointment status mutation, non-doctor EMR insert, null-org audit spoof, and non-owner org rename denied',
    );
  } finally {
    if (inserted) {
      await pool.query('DELETE FROM reviews WHERE doctor_id=ANY($1::uuid[])', [
        [docA, docB, docPending],
      ]);
      await pool.query('DELETE FROM medical_records WHERE organization_id=ANY($1::uuid[])', [
        [orgA, orgB],
      ]);
      await pool.query('DELETE FROM availability_exceptions WHERE doctor_id=ANY($1::uuid[])', [
        [docA, docB, docPending],
      ]);
      await pool.query('DELETE FROM audit_logs WHERE organization_id=ANY($1::uuid[])', [
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
