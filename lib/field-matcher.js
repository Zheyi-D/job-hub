// ================================================================
// JobHub — AI 驱动的字段匹配引擎
// 需要配置 AI API Key。无 Key 时扫描按钮禁用。
// ================================================================
import { callAI, isAiEnabled, getAiConfig } from './ai-client.js';

export async function matchFieldsWithAI(resumeFields, pageElements) {
  const config = await getAiConfig();
  if (!isAiEnabled(config)) throw new Error('AI 未配置');

  const fieldList = resumeFields.map((f, i) =>
    `[${i}] label="${f.label}" value="${f.value.slice(0, 80)}"`
  ).join('\n');

  const elementList = pageElements.map((el, i) => {
    const label = el.labelText || el.placeholder || el.name || el.id || '';
    return `[${i}] tag=${el.tag} type=${el.type || 'text'} label="${label.slice(0, 60)}"`;
  }).join('\n');

  const response = await callAI({
    systemPrompt: '你是表单匹配专家。根据语义将简历字段匹配到网页表单元素。返回 JSON 数组：[{"fieldIndex":0,"elementIndex":2,"confidence":"high"}]。confidence: high/medium/low。只输出 JSON。',
    userMessage: `简历字段：\n${fieldList}\n\n网页表单元素：\n${elementList}`,
    temperature: 0.0,
    jsonMode: true
  });

  let jsonStr = response;
  const m = response.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (m) jsonStr = m[1].trim();
  else { const s = response.indexOf('['), e = response.lastIndexOf(']'); if (s>=0 && e>s) jsonStr = response.slice(s, e+1); }

  let pairs;
  try { pairs = JSON.parse(jsonStr); if (!Array.isArray(pairs)) throw null; }
  catch { return []; }

  const matches = [], used = new Set();
  for (const p of pairs) {
    const field = resumeFields[p.fieldIndex], el = pageElements[p.elementIndex];
    if (!field || !el || used.has(p.elementIndex)) continue;
    used.add(p.elementIndex);
    matches.push({ field, element: el, confidence: p.confidence || 'medium' });
  }
  return matches;
}
