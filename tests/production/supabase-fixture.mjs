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

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:4191').pathname;
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
