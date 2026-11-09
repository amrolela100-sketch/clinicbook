import { NextResponse } from 'next/server';
import { demoEnabled, isSupabaseConfigured } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const isDemo = demoEnabled();
  const supabaseReady = isSupabaseConfigured();
  const aiGatewayConfigured = Boolean(
    process.env.GROQ_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    process.env.AGENTROUTER_API_KEY,
  );

  const healthy = isDemo || supabaseReady;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      service: 'clinicbook-saas',
      mode: isDemo ? 'demo' : 'production',
      timestamp: new Date().toISOString(),
      checks: {
        databaseConfigured: healthy,
        aiAssistantMode: aiGatewayConfigured ? 'hybrid_llm_and_local_triage' : 'local_triage_only',
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
