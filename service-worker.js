// ================================================================
// JobHub — Service Worker
// 职责：Side Panel 生命周期、JT_* 消息路由、飞书 API 调用、版本更新检查
// ================================================================
import { createRecord, listFields, clearTokenCache } from './lib/feishu-api.js';
import {
  getConfig, isConfigComplete, appendHistory, updateHistoryItem,
  getHistory, normalizeUrl
} from './lib/storage.js';
import {
  DEFAULT_FIELD_MAP, REQUIRED_FIELDS, EXPECTED_FIELD_TYPES, FIELD_TYPE_NAMES,
  STORAGE_KEYS, UPDATE_REPO_API, UPDATE_CHECK_INTERVAL_MIN
} from './lib/constants.js';

// 点击工具栏图标打开侧边栏
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // 只处理 JT_ 前缀的消息；FILL/CHECK_FOCUS 走 sidepanel→content 直连
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
    case 'JT_CHECK_UPDATE':   return checkUpdateAndRespond();
    case 'JT_DISMISS_UPDATE': return dismissUpdate(message.version);
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

// ---------- 版本更新检测 ----------
function compareVersions(a, b) {
  const pa = (a || '0.0.0').split('.').map(Number);
  const pb = (b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function checkUpdateCore() {
  try {
    const resp = await fetch(UPDATE_REPO_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!resp.ok) return null;
    const release = await resp.json();
    const remoteVer = (release.tag_name || '').replace(/^v/, '');
    const localVer = chrome.runtime.getManifest().version;
    if (compareVersions(remoteVer, localVer) > 0) {
      const info = {
        version: remoteVer,
        tag: release.tag_name,
        body: release.body || '',
        url: release.html_url || '',
        checkedAt: Date.now()
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.updateInfo]: info });
      chrome.action.setBadgeText({ text: '●' });
      chrome.action.setBadgeBackgroundColor({ color: '#ffcc00' });
      return info;
    } else {
      chrome.action.setBadgeText({ text: '' });
      await chrome.storage.local.remove(STORAGE_KEYS.updateInfo);
      return null;
    }
  } catch {
    return null;
  }
}

async function checkUpdate() { await checkUpdateCore(); }

async function checkUpdateAndRespond() {
  const info = await checkUpdateCore();
  return info
    ? { ok: true, hasUpdate: true, info }
    : { ok: true, hasUpdate: false, info: null };
}

async function dismissUpdate(version) {
  await chrome.storage.session.set({ [STORAGE_KEYS.updateDismissed]: version });
  return { ok: true };
}

// 清除旧缓存再检查，避免残留数据误触发更新提示
chrome.storage.local.remove(STORAGE_KEYS.updateInfo).then(() => checkUpdate());
chrome.alarms.create('jt-check-update', { periodInMinutes: UPDATE_CHECK_INTERVAL_MIN });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'jt-check-update') checkUpdate();
});
