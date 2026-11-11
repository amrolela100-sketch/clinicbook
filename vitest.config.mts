import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  // Next preserves JSX for SWC; Vite must compile it when importing TSX in tests.
  oxc: { jsx: { runtime: 'automatic' } },
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
