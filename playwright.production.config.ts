import { defineConfig } from '@playwright/test';

const appUrl = 'http://127.0.0.1:3100';
const fixtureUrl = 'http://127.0.0.1:4191';

export default defineConfig({
  testDir: './tests/production',
  outputDir: 'test-results/production',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: appUrl,
    channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  webServer: [
    {
      command: 'node tests/production/supabase-fixture.mjs',
      url: `${fixtureUrl}/health`,
      reuseExistingServer: false,
    },
    {
      command:
        'node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100',
      url: `${appUrl}/login`,
      timeout: 240000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'production',
        CLINICBOOK_MODE: 'production',
        FORCE_SUPABASE: 'false',
        COOKIE_SECURE: 'true',
        CSP_ENFORCE: 'true',
        CSP_REPORT_ONLY: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_APP_URL: appUrl,
        NEXT_PUBLIC_SUPABASE_URL: fixtureUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-production-test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: '',
        GROQ_API_KEY: '',
        GEMINI_API_KEY: '',
        OPENROUTER_API_KEY: '',
        OPENAI_API_KEY: '',
        AI_API_KEY: '',
        AGENTROUTER_API_KEY: '',
      },
    },
  ],
});
