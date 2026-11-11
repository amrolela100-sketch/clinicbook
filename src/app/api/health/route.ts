import { NextResponse } from 'next/server';
import { demoEnabled } from '@/lib/auth/session';
import { createSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const HEALTHCHECK_TIMEOUT_MS = 2_000;
const HEALTHCHECK_RPC = 'healthcheck';
const HEALTHCHECK_SCHEMA = '20261111000012';

function isHealthyPayload(payload: unknown): boolean {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { ok?: unknown }).ok === true &&
    (payload as { schema?: unknown }).schema === HEALTHCHECK_SCHEMA
  );
}

async function databaseIsHealthy(): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (demoEnabled()) {
      return true;
    }

    const controller = new AbortController();
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error('HEALTHCHECK_TIMEOUT'));
      }, HEALTHCHECK_TIMEOUT_MS);
    });

    const { data, error } = await Promise.race([
      createSupabaseAdmin().rpc(HEALTHCHECK_RPC).abortSignal(controller.signal),
      timeoutPromise,
    ]);

    return !error && isHealthyPayload(data);
  } catch {
    return false;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

export async function GET() {
  const database = await databaseIsHealthy().catch(() => false);
  const healthy = database;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'clinicbook-saas',
      timestamp: new Date().toISOString(),
      checks: {
        database,
      },
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    },
  );
}
