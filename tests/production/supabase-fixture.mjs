// Public-directory fixture only. This is not an Auth, RLS or PostgREST emulator.
// It binds to loopback and never contains a real key, user or patient record.
import { createServer } from 'node:http';

const doctor = {
  id: '11111111-1111-4111-8111-111111111111',
  full_name: 'طبيب اختبار الإنتاج',
  title_ar: 'طبيب عام',
  bio_ar: 'بيانات وهمية لاختبار سياسة السكربتات.',
  specialty_id: '22222222-2222-4222-8222-222222222222',
  specialty_name: 'الطب العام',
  organization_id: '33333333-3333-4333-8333-333333333333',
  clinic_id: '44444444-4444-4444-8444-444444444444',
  clinic_name: 'عيادة الاختبار',
  city_name: 'دمشق',
  district: 'منطقة الاختبار',
  consultation_fee: 25,
  follow_up_fee: 15,
  years_of_experience: 10,
  rating_avg: 0,
  reviews_count: 0,
  avatar_url: 'doctor-1.jpg',
  license_number: 'FIXTURE-ONLY',
  booking_horizon_days: 30,
  cancel_window_hours: 2,
};

const fixtures = new Map([
  ['/health', { status: 'fixture-ready' }],
  ['/rest/v1/rpc/public_doctor_directory', [doctor]],
  ['/rest/v1/rpc/public_reviews', []],
  ['/rest/v1/rpc/get_available_slots', []],
  ['/rest/v1/availability', []],
  ['/rest/v1/cities', [{ id: 'fixture-city', name_ar: 'دمشق', name_en: 'Damascus' }]],
  [
    '/rest/v1/specialties',
    [{ id: doctor.specialty_id, name_ar: 'الطب العام', name_en: 'General Medicine' }],
  ],
]);

const redisCounters = new Map();
let redisMode = 'healthy';
let databaseMode = 'healthy';

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:4191').pathname;
  if (pathname === '/test-control') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const control = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (control.reset) redisCounters.clear();
    if (control.mode) redisMode = control.mode;
    if (control.databaseMode) databaseMode = control.databaseMode;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ready' }));
    return;
  }
  if (pathname === '/rest/v1/rpc/healthcheck') {
    request.resume();
    if (request.headers.apikey !== 'local-production-test-service-key') {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ code: 'FIXTURE_SERVICE_ROLE_REQUIRED' }));
      return;
    }
    if (databaseMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      if (response.destroyed) return;
    }
    const failed = databaseMode === 'fail' || databaseMode === 'missing';
    response.writeHead(failed ? 503 : 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    response.end(
      JSON.stringify(
        failed
          ? { code: databaseMode === 'missing' ? 'PGRST202' : 'PGRST001', message: 'private-dsn' }
          : { ok: databaseMode !== 'malformed', schema: '20261111000012' },
      ),
    );
    return;
  }
  if (pathname === '/auth/v1/token') {
    request.resume();
    response.writeHead(401, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ msg: 'Invalid login credentials', code: 'invalid_credentials' }));
    return;
  }
  if (pathname === '/redis') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    if (redisMode === 'fail') {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'fixture redis unavailable' }));
      return;
    }
    if (redisMode === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 3500));
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'fixture redis timeout' }));
      return;
    }
    const command = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
    if (
      request.headers.authorization !== 'Bearer local-redis-fixture-token' ||
      !Array.isArray(command) ||
      !['evalsha', 'eval'].includes(String(command[0]).toLowerCase())
    ) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Unsupported fixture Redis request' }));
      return;
    }
    const keyCount = Number(command[2]);
    const key = command[3];
    const args = command.slice(3 + keyCount);
    const [capacity, interval, , now, cost] = args.map(Number);
    const used = (redisCounters.get(key) ?? 0) + cost;
    redisCounters.set(key, used);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ result: [capacity - used, now + interval, capacity] }));
    return;
  }
  const known = fixtures.has(pathname);
  response.writeHead(known ? 200 : 404, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  response.end(
    JSON.stringify(
      known
        ? fixtures.get(pathname)
        : {
            code: 'UNEXPECTED_FIXTURE_REQUEST',
            message: `Unimplemented fixture endpoint: ${pathname}`,
          },
    ),
  );
});

server.listen(4191, '127.0.0.1');
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
