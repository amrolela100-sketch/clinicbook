import { defineAgent } from './types';

/**
 * إعدادات الوكيل الذكي لمنصة ClinicBook باستخدام Eve
 * يتم توجيه النموذج عبر Vercel AI Gateway لدعم الـ Fallbacks وحفظ الجلسات الدائمة
 */
export default defineAgent({
  model: 'openai/gpt-4o-mini',
  reasoning: 'low',
  temperature: 0.1, // درجة حرارة منخفضة لضمان الدقة وتفادي الهلوسة في المواعيد الطبية
});
