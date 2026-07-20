// ================================================================
// JobHub — Service Worker
// 职责：Side Panel 生命周期、JT_* 消息路由、飞书 API 调用
// ================================================================
import { createRecord, listFields, listRecords, clearTokenCache } from './lib/feishu-api.js';
import {
  getConfig, isConfigComplete, appendHistory, updateHistoryItem,
  getHistory, normalizeUrl
} from './lib/storage.js';
import {
  DEFAULT_FIELD_MAP, REQUIRED_FIELDS, EXPECTED_FIELD_TYPES, FIELD_TYPE_NAMES, STORAGE_KEYS
} from './lib/constants.js';

// 点击工具栏图标打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message.type || !message.type.startsWith('JT_')) return false;

  handle(message)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
  return true;
});

async function handle(message) {
  switch (message.type) {
    case 'JT_SAVE_RECORD':    return saveRecord(message.record);
    case 'JT_SAVE_LOCAL':     return saveLocal(message.record);
    case 'JT_TEST_CONNECTION': return testConnection(message.config);
    case 'JT_RETRY_SYNC':     return retrySync(message.historyId);
    case 'JT_FETCH_REMOTE':   return fetchRemoteRecords();
    default: return { ok: false, error: `未知消息类型：${message.type}` };
  }
}

// ---------- 记录构造 ----------
function toHistoryItem(record, extra) {
  return {
    id: crypto.randomUUID(),
    company: record.company || '',
    position: record.position || '',
    url: record.url || '',
    normalizedUrl: normalizeUrl(record.url || ''),
    linkText: record.linkText || '',
    appliedAt: record.appliedAt,
    statusValue: record.status || '已投递',
    note: record.note || '',
    ...extra
  };
}

// ---------- 保存 ----------
async function saveRecord(record) {
  const config = await getConfig();
  if (!isConfigComplete(config)) {
    return { ok: false, error: '尚未完成飞书配置，请先在设置页填写凭证' };
  }
  const recordId = await createRecord(config, record);
  await appendHistory(toHistoryItem(record, { syncState: 'synced', recordId }));
  return { ok: true, recordId };
}

async function saveLocal(record) {
  await appendHistory(toHistoryItem(record, { syncState: 'local-only', recordId: '' }));
  return { ok: true };
}

async function retrySync(historyId) {
  const config = await getConfig();
  if (!isConfigComplete(config)) return { ok: false, error: '尚未完成飞书配置' };
  const history = await getHistory();
  const item = history.find(h => h.id === historyId);
  if (!item) return { ok: false, error: '未找到该条历史记录' };
  const recordId = await createRecord(config, {
    company: item.company,
    position: item.position,
    appliedAt: item.appliedAt,
    url: item.url,
    linkText: item.linkText,
    status: item.statusValue,
    note: item.note
  });
  await updateHistoryItem(historyId, { syncState: 'synced', recordId });
  return { ok: true, recordId };
}

// ---------- 连接测试 ----------
async function testConnection(rawConfig) {
  let config;
  if (rawConfig) {
    config = { ...rawConfig, fieldMap: { ...DEFAULT_FIELD_MAP, ...(rawConfig.fieldMap || {}) } };
  } else {
    config = await getConfig();
  }
  if (!isConfigComplete(config)) {
    return { ok: false, error: '请先填写完整的四项凭证（App ID / App Secret / app_token / table_id）' };
  }

  await clearTokenCache();
  const fields = await listFields(config);
  const byName = new Map(fields.map(f => [f.field_name, f]));

  const missing = [];
  const typeWarnings = [];
  for (const key of REQUIRED_FIELDS) {
    const name = config.fieldMap[key];
    const field = byName.get(name);
    if (!field) {
      missing.push(name);
    } else if (field.type !== EXPECTED_FIELD_TYPES[key]) {
      typeWarnings.push(
        `「${name}」应为${FIELD_TYPE_NAMES[EXPECTED_FIELD_TYPES[key]]}类型，` +
        `当前是${FIELD_TYPE_NAMES[field.type] || `类型${field.type}`}`
      );
    }
  }

  return {
    ok: missing.length === 0,
    fields: fields.map(f => ({ name: f.field_name, type: FIELD_TYPE_NAMES[f.type] || `类型${f.type}` })),
    missing,
    typeWarnings,
    error: missing.length ? `连接成功，但表格缺少字段：${missing.join('、')}` : ''
  };
}

// ---------- 从飞书拉取全量记录（看板同步用） ----------
async function fetchRemoteRecords() {
  const config = await getConfig();
  if (!isConfigComplete(config)) return { ok: false, error: '尚未完成飞书配置' };

  const rawRecords = await listRecords(config);
  const m = config.fieldMap;

  // 反向映射：飞书列名 → 内部字段名
  const reverseMap = {};
  for (const key of Object.keys(m)) {
    reverseMap[m[key]] = key;
  }

  // 解析飞书记录 → 本地 history 格式
  const historyItems = rawRecords.map(r => {
    const f = r.fields || {};
    const urlField = f[m.link] || {};
    const linkObj = typeof urlField === 'object' && urlField !== null ? urlField : {};

    return {
      id: crypto.randomUUID(),
      company: String(f[m.company] || ''),
      position: String(f[m.position] || ''),
      appliedAt: (() => {
        const v = f[m.appliedAt];
        return typeof v === 'number' ? v : Date.now();
      })(),
      url: typeof linkObj.link === 'string' ? linkObj.link : '',
      normalizedUrl: normalizeUrl(typeof linkObj.link === 'string' ? linkObj.link : ''),
      linkText: typeof linkObj.text === 'string' ? linkObj.text : '',
      statusValue: String(f[m.status] || '已投递'),
      note: String(f[m.note] || ''),
      syncState: 'synced',
      recordId: r.record_id,
      fromRemote: true
    };
  });

  return { ok: true, history: historyItems, fetchedAt: Date.now() };
}
