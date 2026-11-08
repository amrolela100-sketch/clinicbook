import { defineAgent } from './types';

/**
 * إعدادات الوكيل الطبي الذكي لمنصة ClinicBook
 * يتم توجيه النموذج عبر بوابة AgentRouter (واجهة /v1/responses) لدعم التفكير السريري المتقدم
 */
export default defineAgent({
  model: process.env.AGENTROUTER_MODEL || 'gpt-5.6-sol',
  reasoning: 'low',
  temperature: 0.2, // درجة حرارة منخفضة لضمان الدقة وتفادي الهلوسة في المواعيد الطبية
});
