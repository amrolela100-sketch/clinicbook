/**
 * عميل بوابة الذكاء الاصطناعي السريري المتعدد المزوّدات (Multi-Provider Clinical AI Gateway)
 * يدعم كلاً من بروتوكول /v1/chat/completions القياسي (Groq, Gemini, OpenRouter, OpenAI)
 * وبروتوكول /v1/responses مع تجريد كامل للبيانات الشخصية (PII Redaction) وكشف حجب WAF.
 */

export interface AgentRouterContext {
  specialties?: string[];
  doctors?: Array<{ name: string; specialty: string; clinic: string; fee: number }>;
}

interface ResolvedProvider {
  apiKey: string;
  endpointUrl: string;
  model: string;
  protocol: 'responses' | 'chat_completions';
}

function redactPii(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[بريد محذوف]')
    .replace(/(?:\+?\d[\d\s\-().]{6,}\d)/g, '[هاتف محذوف]');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, '').trim();
}

function resolveProviderConfig(): ResolvedProvider | null {
  if (process.env.GROQ_API_KEY) {
    const base = (process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
    return {
      apiKey: process.env.GROQ_API_KEY,
      endpointUrl: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      model: process.env.AI_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      protocol: 'chat_completions',
    };
  }

  if (process.env.GEMINI_API_KEY) {
    const base = (
      process.env.AI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    ).replace(/\/+$/, '');
    return {
      apiKey: process.env.GEMINI_API_KEY,
      endpointUrl: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      model: process.env.AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      protocol: 'chat_completions',
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    const base = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    return {
      apiKey: process.env.OPENROUTER_API_KEY,
      endpointUrl: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      model:
        process.env.AI_MODEL ||
        process.env.OPENROUTER_MODEL ||
        'meta-llama/llama-3.3-70b-instruct:free',
      protocol: 'chat_completions',
    };
  }

  if (process.env.OPENAI_API_KEY) {
    const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      apiKey: process.env.OPENAI_API_KEY,
      endpointUrl: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      model: process.env.AI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      protocol: 'chat_completions',
    };
  }

  if (process.env.AI_API_KEY) {
    const base = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return {
      apiKey: process.env.AI_API_KEY,
      endpointUrl: base.endsWith('/chat/completions') ? base : `${base}/chat/completions`,
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      protocol: 'chat_completions',
    };
  }

  const agentRouterKey = process.env.AGENTROUTER_API_KEY;
  if (!agentRouterKey) {
    return null;
  }

  const baseUrl = (process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1').replace(
    /\/+$/,
    '',
  );
  const isChatCompletionsGateway =
    baseUrl.endsWith('/chat/completions') ||
    /groq\.com|openrouter\.ai|googleapis\.com|api\.openai\.com|deepseek\.com/i.test(baseUrl);

  if (isChatCompletionsGateway) {
    const defaultModel = /groq\.com/i.test(baseUrl)
      ? 'llama-3.3-70b-versatile'
      : /googleapis\.com/i.test(baseUrl)
        ? 'gemini-2.5-flash'
        : 'gpt-4o-mini';
    return {
      apiKey: agentRouterKey,
      endpointUrl: baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`,
      model: process.env.AGENTROUTER_MODEL || defaultModel,
      protocol: 'chat_completions',
    };
  }

  return {
    apiKey: agentRouterKey,
    endpointUrl: `${baseUrl}/responses`,
    model: process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol',
    protocol: 'responses',
  };
}

export async function callAgentRouter(
  message: string,
  context?: AgentRouterContext,
): Promise<{ success: boolean; reply?: string; error?: string }> {
  const provider = resolveProviderConfig();
  if (!provider) {
    return { success: false, error: 'AGENTROUTER_API_KEY is not configured' };
  }

  // Enforce service-level maximum input length (2000 characters) & strip accidental PII
  const trimmed = message.trim().slice(0, 2000);
  if (!trimmed) {
    return { success: false, error: 'Empty message provided' };
  }
  const sanitizedMessage = redactPii(trimmed);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const specsStr =
      context?.specialties?.slice(0, 8).join('، ') ??
      'الطب العام، القلب والأوعية، طب الأطفال، طب الأسنان، الأمراض الجلدية، طب العيون';
    const docsSummary =
      context?.doctors
        ?.map(
          (d) =>
            `• د. ${d.name.slice(0, 80)} (${d.specialty.slice(0, 60)} - ${d.clinic.slice(0, 80)} - الكشفية: ${d.fee} ل.س)`,
        )
        .slice(0, 4)
        .join('\n') ?? '';

    // Instructions contain clinical domain bounds and verified directory only — strictly zero PII
    const instructions = [
      'You are ClinicBook AI Medical Assistant (المساعد الطبي الذكي لمنصة كلينك بوك).',
      'Your role is medical triage, empathy, appointment booking guidance, and symptom exploration.',
      'Always respond in natural, professional, warm, and reassuring Arabic (العربية الفصحى).',
      'Never prescribe prescription medicines, do not give conclusive final diagnoses.',
      'Always prioritize patient safety and direct them to book with the appropriate specialist or emergency if severe.',
      `Available ClinicBook Specialties: ${specsStr}.`,
      docsSummary ? `Verified Doctors on Platform:\n${docsSummary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const inputContent = `Patient message: ${sanitizedMessage}\nPlease reply as ClinicBook AI Assistant directly to the patient in Arabic.`;

    const payload =
      provider.protocol === 'chat_completions'
        ? JSON.stringify({
            model: provider.model,
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: inputContent },
            ],
            temperature: 0.3,
            max_tokens: 500,
          })
        : JSON.stringify({
            model: provider.model,
            instructions,
            input: inputContent,
          });

    const userAgent = sanitizeHeaderValue(
      process.env.AGENTROUTER_USER_AGENT || 'ClinicBook-AI-Triage/1.0 (ClinicBook SaaS)',
    );
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(provider.apiKey)}`,
      'User-Agent': userAgent,
    };
    if (process.env.AGENTROUTER_CUSTOM_APP_HEADER) {
      headers['x-app'] = sanitizeHeaderValue(process.env.AGENTROUTER_CUSTOM_APP_HEADER);
    }

    const res = await fetch(provider.endpointUrl, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });

    if (!res.ok) {
      const status = res.status;
      return { success: false, error: `AI gateway returned HTTP ${status}` };
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const rawBody = await res.text();
    const trimmedBody = rawBody.trimStart();

    if (
      contentType.includes('text/html') ||
      trimmedBody.startsWith('<!doctype html') ||
      trimmedBody.startsWith('<html') ||
      trimmedBody.includes('aliyun_waf')
    ) {
      return {
        success: false,
        error: 'Upstream AI gateway blocked request via WAF HTML challenge',
      };
    }

    const data = JSON.parse(rawBody) as {
      output?: Array<{
        type: string;
        content?: Array<{ type: string; text?: string }>;
      }>;
      choices?: Array<{
        message?: { content?: string | null };
      }>;
    };

    const textOutput =
      provider.protocol === 'chat_completions'
        ? data.choices?.[0]?.message?.content?.trim()
        : (data.output
            ?.find((o) => o.type === 'message')
            ?.content?.find((c) => c.type === 'output_text')
            ?.text?.trim() ?? data.choices?.[0]?.message?.content?.trim());

    if (!textOutput) {
      return { success: false, error: 'Empty text output received from model' };
    }

    return { success: true, reply: textOutput };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown network error';
    return { success: false, error: errorMsg };
  } finally {
    clearTimeout(timeoutId);
  }
}
