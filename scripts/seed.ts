import { all, appointments } from '../src/lib/demo-db';
console.log('Demo database ready (idempotent seed).', {
  users: all('user').length,
  doctors: all('doctor').length,
  appointments: appointments().length,
});
