import { db, appointments } from '../src/lib/demo-db';
const base = process.env.APP_URL ?? 'http://localhost:3000';
async function run() {
  const login = await fetch(base + '/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'receptionist' }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw Error('Demo login failed');
  let slot: { start: string; end: string } | undefined;
  for (let days = 3; days < 10 && !slot; days++) {
    const date = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const j = await fetch(base + `/api/slots?doctorId=doctor-1&date=${date}`).then((r) => r.json());
    slot = j.data?.[0];
  }
  if (!slot) throw Error('No available test slot');
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      fetch(base + '/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          doctorId: 'doctor-1',
          start: slot!.start,
          patientName: `اختبار تزامن ${i}`,
          phone: '+963999999999',
          visitType: 'walk_in',
        }),
      }).then(async (r) => ({ status: r.status, data: await r.json() })),
    ),
  );
  const success = results.filter((r) => r.status === 201),
    conflict = results.filter((r) => r.status === 409);
  const rows = appointments().filter(
    (a) =>
      a.doctorId === 'doctor-1' &&
      a.start === slot!.start &&
      ['pending', 'confirmed', 'checked_in'].includes(a.status),
  );
  console.log(
    JSON.stringify(
      {
        engine: 'SQLite local demo, real HTTP requests',
        requests: 50,
        success: success.length,
        conflicts: conflict.length,
        activeRows: rows.length,
        doubleBookings: Math.max(0, rows.length - 1),
      },
      null,
      2,
    ),
  );
  for (const r of success) {
    db.prepare('DELETE FROM appointments WHERE id=?').run(r.data.data.id);
    db.prepare('DELETE FROM audit WHERE entity_id=?').run(r.data.data.id);
  }
  if (success.length !== 1 || conflict.length !== 49 || rows.length !== 1) {
    console.log(results.filter((r) => r.status !== 201 && r.status !== 409));
    process.exitCode = 1;
  }
}
run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
