import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The browser server AND Node-side fixtures/cleanup must share an isolated DB.
// Workers inherit this run ID instead of creating another or using data/*.sqlite.
const runId = process.env.CLINICBOOK_E2E_RUN_ID ?? randomUUID();
const databasePath = path.resolve('test-results', `demo-${runId}.sqlite`);
const distDir = `test-results/next-demo-${runId}`;
const typeScriptConfig = `tsconfig.e2e-${runId}.json`;
// Webpack development can return 500 on the first compilation of /search.
// Keep it selectable for diagnosis; production build/start still use Webpack.
const bundler = process.env.CLINICBOOK_E2E_BUNDLER ?? 'turbopack';
if (bundler !== 'webpack' && bundler !== 'turbopack') {
  throw new Error('CLINICBOOK_E2E_BUNDLER must be webpack or turbopack.');
}
// Next adds its generated type directory to the selected config. Keep that
// mutation in an ignored run-specific file, not in the tracked tsconfig.json.
if (!existsSync(typeScriptConfig)) {
  writeFileSync(
    typeScriptConfig,
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', `${distDir}/types/**/*.ts`],
        exclude: ['node_modules'],
      },
      null,
      2,
    )}\n`,
    { flag: 'wx' },
  );
}
Object.assign(process.env, {
  CLINICBOOK_E2E_RUN_ID: runId,
  CLINICBOOK_DB_PATH: databasePath,
  CLINICBOOK_MODE: 'demo',
  FORCE_SUPABASE: 'false',
  NODE_ENV: 'test',
});
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'test-results/demo',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    baseURL: process.env.APP_URL ?? 'http://localhost:3000',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node node_modules/next/dist/bin/next dev${bundler === 'turbopack' ? ' --turbopack' : ''} --hostname 127.0.0.1 --port 3000`,
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: 'development',
      CLINICBOOK_MODE: 'demo',
      CLINICBOOK_NEXT_DIST_DIR: distDir,
      CLINICBOOK_NEXT_TSCONFIG: typeScriptConfig,
      FORCE_SUPABASE: 'false',
      CLINICBOOK_DB_PATH: databasePath,
      COOKIE_SECURE: 'false',
      CSP_ENFORCE: 'false',
      CSP_REPORT_ONLY: 'true',
      NEXT_PUBLIC_SUPABASE_URL: '',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      GROQ_API_KEY: '',
      GEMINI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPENAI_API_KEY: '',
      AI_API_KEY: '',
      AGENTROUTER_API_KEY: '',
    },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
