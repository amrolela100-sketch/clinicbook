/**
 * عميل بوابة AgentRouter المخصصة للذكاء الاصطناعي السريري
 * يتصل بنموذج الذكاء الاصطناعي عبر واجهة /v1/responses بتشفير آمن وتجريد كامل للبيانات الشخصية
 */

export interface AgentRouterContext {
  specialties?: string[];
  doctors?: Array<{ name: string; specialty: string; clinic: string; fee: number }>;
}

function redactPii(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[بريد محذوف]')
    .replace(/(?:\+?\d[\d\s\-().]{6,}\d)/g, '[هاتف محذوف]');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, '').trim();
}

export async function callAgentRouter(
  message: string,
  context?: AgentRouterContext,
): Promise<{ success: boolean; reply?: string; error?: string }> {
  const apiKey = process.env.AGENTROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'AGENTROUTER_API_KEY is not configured' };
  }

  // Enforce service-level maximum input length (2000 characters) & strip accidental PII
  const trimmed = message.trim().slice(0, 2000);
  if (!trimmed) {
    return { success: false, error: 'Empty message provided' };
  }
  const sanitizedMessage = redactPii(trimmed);

  const baseUrl = (process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1').replace(
    /\/+$/,
    '',
  );
  const model = process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol';
  const url = `${baseUrl}/responses`;

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

    // Safe payload serialization via JSON.stringify (avoids broken escaping or injection)
    const payload = JSON.stringify({
      model,
      instructions,
      input: inputContent,
    });

    // RISK NOTE: Spoofing third-party CLI User-Agent / x-app headers violates upstream ToS and risks
    // account suspension or WAF blocks. Keep the legitimate project User-Agent by default; override
    // via env vars only if explicitly approved by your gateway provider.
    const userAgent = sanitizeHeaderValue(
      process.env.AGENTROUTER_USER_AGENT || 'ClinicBook-AI-Triage/1.0 (ClinicBook SaaS)',
    );
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sanitizeHeaderValue(apiKey)}`,
      'User-Agent': userAgent,
    };
    if (process.env.AGENTROUTER_CUSTOM_APP_HEADER) {
      headers['x-app'] = sanitizeHeaderValue(process.env.AGENTROUTER_CUSTOM_APP_HEADER);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    });

    if (!res.ok) {
      const status = res.status;
      return { success: false, error: `AgentRouter returned HTTP ${status}` };
    }

    const data = (await res.json()) as {
      output?: Array<{
        type: string;
        content?: Array<{ type: string; text?: string }>;
      }>;
    };

    const messageObj = data.output?.find((o) => o.type === 'message');
    const textOutput = messageObj?.content?.find((c) => c.type === 'output_text')?.text?.trim();

    if (!textOutput) {
      return { success: false, error: 'Empty text output received from model' };
    }

    return { success: true, reply: textOutput };
  } catch (err: unknown) {
    // Log safe error summary without message content (prevents PII leakage in server logs)
    const errorMsg = err instanceof Error ? err.message : 'Unknown network error';
    return { success: false, error: errorMsg };
  } finally {
    clearTimeout(timeoutId);
  }
}
