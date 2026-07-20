// ================================================================
// JobHub — AI API Client
// 统一 OpenAI-compatible 接口，支持 DeepSeek / Kimi / 豆包 / 自定义
// ================================================================

// ---------- Provider presets ----------
export const AI_PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
    defaultModel: 'deepseek-chat'
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    endpoint: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    defaultModel: 'moonshot-v1-32k'
  },
  doubao: {
    name: '豆包 (字节)',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-pro-32k'],
    defaultModel: 'doubao-pro-32k'
  },
  custom: {
    name: '自定义',
    endpoint: '',
    models: [],
    defaultModel: ''
  }
};

// ---------- AI config helpers ----------

const AI_CONFIG_KEY = 'af_ai_config';

export async function getAiConfig() {
  const data = await chrome.storage.local.get(AI_CONFIG_KEY);
  return data[AI_CONFIG_KEY] || null;
}

export async function saveAiConfig(config) {
  await chrome.storage.local.set({ [AI_CONFIG_KEY]: config });
}

export function isAiEnabled(config) {
  return !!(config && config.enabled && config.apiKey && config.provider);
}

// ---------- Core API call ----------

export async function callAI({ systemPrompt, userMessage, temperature = 0.1, jsonMode = true }) {
  const config = await getAiConfig();
  if (!isAiEnabled(config)) {
    throw new Error('AI 未配置：请在设置页填写 API Key 并开启 AI 辅助');
  }

  const provider = AI_PROVIDERS[config.provider];
  if (!provider) throw new Error(`未知 AI 服务商：${config.provider}`);

  const endpoint = config.endpoint || provider.endpoint;
  const model = config.model || provider.defaultModel;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature
  };

  // DeepSeek and Kimi support json_object response format
  if (jsonMode && (config.provider === 'deepseek' || config.provider === 'kimi')) {
    body.response_format = { type: 'json_object' };
  } else if (jsonMode) {
    // For providers that don't support json_object natively, enforce via prompt
    body.messages[0].content += '\n\nIMPORTANT: You MUST respond with valid JSON only. No other text.';
  }

  const resp = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let errMsg = `API 请求失败 (HTTP ${resp.status})`;
    if (resp.status === 401) errMsg = 'API Key 无效，请检查设置';
    else if (resp.status === 429) errMsg = 'API 调用频率过高，请稍后重试';
    else if (resp.status === 402) errMsg = 'API 账户余额不足';
    throw new Error(errMsg + (errText ? `：${errText.slice(0, 200)}` : ''));
  }

  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI 返回内容为空');
  return content;
}

// ---------- Test connection ----------

export async function testAiConnection(config) {
  const provider = AI_PROVIDERS[config.provider];
  if (!provider) return { ok: false, error: '未知服务商' };

  const endpoint = config.endpoint || provider.endpoint;
  const model = config.model || provider.defaultModel;

  try {
    const resp = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '回复 "OK"' }],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}: ${errText.slice(0, 200)}` };
    }

    const data = await resp.json();
    return { ok: true, model, content: data.choices?.[0]?.message?.content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
