import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
    command: 'node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      NODE_ENV: 'development',
      CLINICBOOK_MODE: 'demo',
      FORCE_SUPABASE: 'false',
      CLINICBOOK_DB_PATH: path.resolve('test-results', `demo-${randomUUID()}.sqlite`),
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
