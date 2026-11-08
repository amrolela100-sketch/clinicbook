import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callAgentRouter } from '../../src/lib/services/agentrouter-client';

describe('Unit: AgentRouter AI Client (/v1/responses)', () => {
  const originalApiKey = process.env.AGENTROUTER_API_KEY;

  beforeEach(() => {
    process.env.AGENTROUTER_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env.AGENTROUTER_API_KEY = originalApiKey;
    vi.restoreAllMocks();
  });

  it('fails gracefully when AGENTROUTER_API_KEY is missing', async () => {
    delete process.env.AGENTROUTER_API_KEY;

    const res = await callAgentRouter('أشعر بصداع');
    expect(res.success).toBe(false);
    expect(res.error).toContain('not configured');
  });

  it('successfully parses model text output from AgentRouter Responses format', async () => {
    const mockOutput = {
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'سلامتك. أنصحك باستشارة طبيب عام وإجراء فحص دوري.',
            },
          ],
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockOutput), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await callAgentRouter('عندي صداع خفيف', {
      specialties: ['الطب العام'],
    });

    expect(res.success).toBe(true);
    expect(res.reply).toContain('سلامتك');
  });

  it('handles HTTP error responses gracefully without crashing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'rate limit' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const res = await callAgentRouter('عندي استفسار');
    expect(res.success).toBe(false);
    expect(res.error).toContain('429');
  });
});
