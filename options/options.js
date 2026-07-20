// ================================================================
// JobHub — Options Page (设置页)
// 飞书凭证 + 字段映射 + 历史管理 + 简历导入导出 + 初始化
// ================================================================
import { getConfig, saveConfig, getHistory, clearHistory, getProfiles, saveProfiles, getActiveProfileId } from '../lib/storage.js';
import { DEFAULT_FIELD_MAP, STORAGE_KEYS, createEmptyProfile } from '../lib/constants.js';
import { getAiConfig, saveAiConfig, AI_PROVIDERS, testAiConnection } from '../lib/ai-client.js';

const $ = id => document.getElementById(id);
const MAP_KEYS = ['company', 'position', 'appliedAt', 'link', 'status', 'note'];

init();

async function init() {
  await loadConfig();
  await loadAiConfig();
  await renderHistory();

  // Feishu config
  $('btnSaveConfig').addEventListener('click', onSaveConfig);
  $('btnTest').addEventListener('click', onTestConnection);
  $('cAppToken').addEventListener('change', parseBaseUrl);
  $('cAppToken').addEventListener('blur', parseBaseUrl);

  // History
  $('btnExport').addEventListener('click', onExport);
  $('btnClear').addEventListener('click', onClear);

  // Resume
  $('btnExportResume').addEventListener('click', onExportResume);
  $('btnImportResume').addEventListener('click', () => $('resumeFileInput').click());
  $('resumeFileInput').addEventListener('change', onImportResume);

  // Reset
  $('btnResetAll').addEventListener('click', onResetAll);

  // AI config
  $('aiProvider').addEventListener('change', onProviderChange);
  $('btnSaveAi').addEventListener('click', onSaveAi);
  $('btnTestAi').addEventListener('click', onTestAi);

  // Update
  showUpdateIfAvailable();
  $('optUpdateDismiss').addEventListener('click', () => $('optUpdateCard').classList.add('hidden'));
  $('optUpdateBtn').addEventListener('click', () => {
    const url = $('optUpdateCard').dataset.updateUrl;
    if (url) chrome.tabs.create({ url, active: true });
  });
}

// ==================== Config ====================

async function loadConfig() {
  const config = await getConfig();
  if (!config) return;
  $('cAppId').value = config.appId || '';
  $('cAppSecret').value = config.appSecret || '';
  $('cAppToken').value = config.appToken || '';
  $('cTableId').value = config.tableId || '';
  for (const key of MAP_KEYS) {
    const v = (config.fieldMap && config.fieldMap[key]) || '';
    if (v && v !== DEFAULT_FIELD_MAP[key]) {
      const el = $('m' + key.charAt(0).toUpperCase() + key.slice(1));
      if (el) el.value = v;
    }
  }
}

function collectConfig() {
  const fieldMap = {};
  for (const key of MAP_KEYS) {
    const el = $('m' + key.charAt(0).toUpperCase() + key.slice(1));
    const v = el ? el.value.trim() : '';
    if (v) fieldMap[key] = v;
  }
  return {
    appId: $('cAppId').value.trim(),
    appSecret: $('cAppSecret').value.trim(),
    appToken: $('cAppToken').value.trim(),
    tableId: $('cTableId').value.trim(),
    fieldMap
  };
}

function parseBaseUrl() {
  const raw = $('cAppToken').value.trim();
  if (!/^https?:\/\//.test(raw)) return;
  if (raw.includes('/wiki/')) {
    showMsg('configMsg', '⚠ 这是知识库（/wiki/）链接，请把表格放到"我的空间"，使用 /base/ 开头的链接', 'warn');
    return;
  }
  const tokenMatch = raw.match(/\/base\/([A-Za-z0-9]+)/);
  if (!tokenMatch) {
    showMsg('configMsg', '未能从链接中解析出 app_token', 'error');
    return;
  }
  $('cAppToken').value = tokenMatch[1];
  try {
    const tableId = new URL(raw).searchParams.get('table');
    if (tableId && !$('cTableId').value.trim()) $('cTableId').value = tableId;
  } catch { /* ignore */ }
  showMsg('configMsg', '已从链接自动解析 app_token' + ($('cTableId').value ? ' 和 table_id' : ''), 'success');
}

async function onSaveConfig() {
  const config = collectConfig();
  if (!config.appId || !config.appSecret || !config.appToken || !config.tableId) {
    showMsg('configMsg', '请填写完整的四项凭证', 'error');
    return;
  }
  await saveConfig(config);
  showMsg('configMsg', '✓ 配置已保存', 'success');
}

async function onTestConnection() {
  const btn = $('btnTest');
  btn.disabled = true;
  btn.textContent = '测试中…';
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'JT_TEST_CONNECTION', config: collectConfig() });
    if (resp && resp.ok) {
      let text = `✓ 连接成功，字段校验通过。表格现有 ${resp.fields.length} 个字段：\n` +
        resp.fields.map(f => `· ${f.name}（${f.type}）`).join('\n');
      if (resp.typeWarnings && resp.typeWarnings.length) {
        text += `\n\n⚠ 类型建议：\n${resp.typeWarnings.join('\n')}`;
      }
      showMsg('configMsg', text, resp.typeWarnings && resp.typeWarnings.length ? 'warn' : 'success');
    } else {
      showMsg('configMsg', (resp && resp.error) || '测试失败', 'error');
    }
  } catch (err) {
    showMsg('configMsg', `测试失败：${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '测试连接';
  }
}

// ==================== History ====================

async function renderHistory() {
  const history = await getHistory();
  $('historyCount').textContent = history.length ? `（${history.length} 条）` : '';
  const list = $('historyList');
  list.textContent = '';

  if (!history.length) {
    const empty = document.createElement('div');
    empty.className = 'opt-empty';
    empty.textContent = '暂无投递记录';
    list.appendChild(empty);
    return;
  }

  for (const item of history) {
    const row = document.createElement('div');
    row.className = 'opt-history-item';

    const time = document.createElement('span');
    time.className = 'opt-history-time';
    time.textContent = formatDate(item.appliedAt);

    const who = document.createElement('span');
    who.className = 'opt-history-who';
    if (item.url) {
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.textContent = `${item.company} · ${item.position}`;
      who.appendChild(a);
    } else {
      who.textContent = `${item.company} · ${item.position}`;
    }

    const badge = document.createElement('span');
    badge.className = `badge opt-badge-${item.syncState}`;
    badge.textContent = item.syncState === 'synced' ? '已同步' : '仅本地';

    row.append(time, who, badge);

    if (item.syncState === 'local-only') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn btn-sm';
      retryBtn.textContent = '重试同步';
      retryBtn.addEventListener('click', () => onRetry(item.id, retryBtn));
      row.appendChild(retryBtn);
    }
    list.appendChild(row);
  }
}

async function onRetry(historyId, btn) {
  btn.disabled = true;
  btn.textContent = '同步中…';
  const resp = await chrome.runtime.sendMessage({ type: 'JT_RETRY_SYNC', historyId });
  if (resp && resp.ok) {
    showMsg('historyMsg', '✓ 已同步到飞书', 'success');
    await renderHistory();
  } else {
    btn.disabled = false;
    btn.textContent = '重试同步';
    showMsg('historyMsg', (resp && resp.error) || '同步失败', 'error');
  }
}

async function onExport() {
  const history = await getHistory();
  downloadJSON(history, `投递记录-${ymd(Date.now())}.json`);
}

async function onClear() {
  if (!confirm('确定清空全部本地投递历史？（不影响飞书表格中的数据）')) return;
  await clearHistory();
  await renderHistory();
  showMsg('historyMsg', '已清空本地历史', 'success');
}

// ==================== Resume Management ====================

async function onExportResume() {
  const [profiles, activeId] = await Promise.all([getProfiles(), getActiveProfileId()]);
  downloadJSON({ profiles, activeProfileId: activeId, exportedAt: Date.now() }, `简历数据-${ymd(Date.now())}.json`);
}

async function onImportResume() {
  const file = $('resumeFileInput').files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.profiles || !Array.isArray(data.profiles)) {
      showMsg('resumeMsg', '文件格式不正确：缺少 profiles 数组', 'error');
      return;
    }

    if (!confirm(`即将导入 ${data.profiles.length} 份简历，当前数据将被覆盖。确定继续？`)) return;

    await saveProfiles(data.profiles);
    if (data.activeProfileId) {
      const { setActiveProfileId } = await import('../lib/storage.js');
      await setActiveProfileId(data.activeProfileId);
    }
    showMsg('resumeMsg', `✓ 已导入 ${data.profiles.length} 份简历`, 'success');
  } catch (err) {
    showMsg('resumeMsg', `导入失败：${err.message}`, 'error');
  } finally {
    $('resumeFileInput').value = '';
  }
}

// ==================== Reset All ====================

async function onResetAll() {
  const confirmed = confirm(
    '确定初始化？将清空：\n' +
    '· 本地投递历史\n· 未保存的表单草稿\n' +
    '· 飞书凭证与字段映射\n· 简历数据\n\n' +
    '不影响飞书表格中已同步的数据。'
  );
  if (!confirmed) return;

  // Clear all JobHub data
  await chrome.storage.local.remove([
    STORAGE_KEYS.config, STORAGE_KEYS.history, STORAGE_KEYS.updateInfo,
    STORAGE_KEYS.profiles, STORAGE_KEYS.activeProfileId
  ]);
  await chrome.storage.session.remove([
    STORAGE_KEYS.draft, STORAGE_KEYS.token, STORAGE_KEYS.updateDismissed
  ]);

  // Clear form fields
  for (const id of ['cAppId', 'cAppSecret', 'cAppToken', 'cTableId']) $(id).value = '';
  for (const key of MAP_KEYS) {
    const el = $('m' + key.charAt(0).toUpperCase() + key.slice(1));
    if (el) el.value = '';
  }
  $('configMsg').className = 'msg hidden';
  await renderHistory();
  showMsg('resetMsg', '✓ 已恢复默认状态', 'success');
}

// ==================== Utils ====================

function showMsg(id, text, kind) {
  const msg = $(id);
  msg.textContent = text;
  msg.className = `msg ${kind || 'info'}`;
}

function formatDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ymd(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ==================== AI Configuration ====================

async function loadAiConfig() {
  const config = await getAiConfig();
  if (!config) return;
  $('aiEnabled').checked = !!config.enabled;
  $('aiProvider').value = config.provider || 'deepseek';
  $('aiApiKey').value = config.apiKey || '';
  $('aiEndpoint').value = config.endpoint || '';
  $('aiModel').value = config.model || '';
  onProviderChange(); // update endpoint/model placeholders
}

function onProviderChange() {
  const provider = $('aiProvider').value;
  const preset = AI_PROVIDERS[provider];
  if (!preset) return;
  if (provider !== 'custom') {
    $('aiEndpoint').value = preset.endpoint;
    $('aiEndpoint').placeholder = preset.endpoint;
    $('aiModel').value = preset.defaultModel;
    $('aiModel').placeholder = preset.defaultModel;
  } else {
    $('aiEndpoint').placeholder = 'https://your-api.com/v1';
    $('aiModel').placeholder = 'model-name';
  }
}

async function onSaveAi() {
  const config = {
    enabled: $('aiEnabled').checked,
    provider: $('aiProvider').value,
    apiKey: $('aiApiKey').value.trim(),
    endpoint: $('aiEndpoint').value.trim(),
    model: $('aiModel').value.trim()
  };
  await saveAiConfig(config);
  showMsg('aiMsg', '✓ AI 配置已保存', 'success');
}

async function onTestAi() {
  const btn = $('btnTestAi');
  btn.disabled = true;
  btn.textContent = '测试中…';
  const config = {
    enabled: true,
    provider: $('aiProvider').value,
    apiKey: $('aiApiKey').value.trim(),
    endpoint: $('aiEndpoint').value.trim(),
    model: $('aiModel').value.trim()
  };
  if (!config.apiKey) {
    showMsg('aiMsg', '请先填写 API Key', 'error');
    btn.disabled = false;
    btn.textContent = '测试连接';
    return;
  }
  const result = await testAiConnection(config);
  if (result.ok) {
    showMsg('aiMsg', `✓ 连接成功！模型: ${result.model}`, 'success');
  } else {
    showMsg('aiMsg', `连接失败: ${result.error}`, 'error');
  }
  btn.disabled = false;
  btn.textContent = '测试连接';
}

// ==================== Update ====================

async function showUpdateIfAvailable() {
  // Force recheck to avoid stale cache
  const resp = await chrome.runtime.sendMessage({ type: 'JT_CHECK_UPDATE' });
  if (!resp || !resp.hasUpdate || !resp.info) return;
  const url = resp.info.url || '';
  if (!url) return;
  $('optUpdateVersion').textContent = 'v' + resp.info.version;
  const body = (resp.info.body || '').replace(/\r/g, '').trim();
  $('optUpdateBody').textContent = body.length > 250 ? body.slice(0, 250) + '…' : body;
  $('optUpdateCard').dataset.updateUrl = url;
  $('optUpdateCard').classList.remove('hidden');
}
