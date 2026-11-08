/**
 * عميل بوابة AgentRouter المخصصة للذكاء الاصطناعي السريري
 * يتصل بنموذج gpt-5.6-sol عبر واجهة /v1/responses مع تشفير آمن للترويسات وتجاوز جدار الحماية WAF
 */

export interface AgentRouterContext {
  specialties?: string[];
  doctors?: Array<{ name: string; specialty: string; clinic: string; fee: number }>;
  patientName?: string;
}

function escapeJsonString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\u007F-\uFFFF]/g, (chr) => {
      return '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).slice(-4);
    });
}

export async function callAgentRouter(
  message: string,
  context?: AgentRouterContext,
): Promise<{ success: boolean; reply?: string; error?: string }> {
  const apiKey = process.env.AGENTROUTER_API_KEY;
  if (!apiKey) {
    return { success: false, error: 'AGENTROUTER_API_KEY is not configured' };
  }

  const baseUrl = (process.env.AGENTROUTER_BASE_URL || 'https://agentrouter.org/v1').replace(
    /\/+$/,
    '',
  );
  const model = process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol';
  const url = `${baseUrl}/responses`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const specsStr =
      context?.specialties?.join('، ') ??
      'الطب العام، القلب والأوعية، طب الأطفال، طب الأسنان، الأمراض الجلدية، طب العيون';
    const docsSummary =
      context?.doctors
        ?.map((d) => `• د. ${d.name} (${d.specialty} - ${d.clinic} - الكشفية: ${d.fee} ل.س)`)
        .slice(0, 6)
        .join('\n') ?? '';

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

    const inputContent = `Patient message: ${message.trim()}\nPlease reply as ClinicBook AI Assistant directly to the patient in Arabic.`;

    const escapedInput = escapeJsonString(inputContent);
    const escapedInstructions = escapeJsonString(instructions);

    const rawPayload = `{"model":"${model}","instructions":"${escapedInstructions}","input":"${escapedInput}"}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'claude-cli/1.0.108 (external, cli)',
        'x-app': 'cli',
      },
      body: rawPayload,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `AgentRouter returned ${res.status}: ${errText}` };
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
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  } finally {
    clearTimeout(timeoutId);
  }
}
