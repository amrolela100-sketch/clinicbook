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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary', 'json'],
      include: ['src/lib/**/*.{ts,tsx}', 'src/app/api/**/*.ts', 'agent/**/*.ts'],
      // These files contain only erased type declarations, not executable code.
      exclude: ['src/lib/types.ts', 'src/lib/supabase/database.types.ts', 'agent/types.ts'],
      thresholds: { lines: 70, functions: 70, statements: 70, branches: 60 },
    },
    env: {
      CLINICBOOK_MODE: 'demo',
      CLINICBOOK_DB_PATH: ':memory:',
    },
  },
});
