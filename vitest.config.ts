import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      CLINICBOOK_MODE: 'demo',
      CLINICBOOK_DB_PATH: ':memory:',
    },
  },
});
