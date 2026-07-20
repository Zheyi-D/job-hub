// ================================================================
// JobHub — Job Tracker Panel (投递追踪面板)
// 从 job-tracker-extension/sidepanel/sidepanel.js 适配
// 变更：export init/destroy、DOM 作用域限定、Neo-Brutalist 样式类名
// ================================================================
import { getConfig, isConfigComplete, findDuplicate, getDraft, saveDraft, clearDraft } from '../lib/storage.js';
import { STATUS_OPTIONS } from '../lib/constants.js';

// ============ Module State ============
let container, pageTitle, dirty, dismissedVersion;
let tabActivatedListener, tabUpdatedListener;

const FORM_IDS = ['jtCompany', 'jtPosition', 'jtTime', 'jtUrl', 'jtStatus', 'jtNote'];

// Scoped querySelector
function $(id) {
  return container ? container.querySelector('#' + id) : null;
}

// ============ Init / Destroy ============
export async function init(containerEl) {
  container = containerEl;

  // Fill status select
  const statusSelect = $('jtStatus');
  if (statusSelect && statusSelect.options.length === 0) {
    STATUS_OPTIONS.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (opt === '已投递') o.selected = true;
      statusSelect.appendChild(o);
    });
  }

  const config = await getConfig();
  if (!isConfigComplete(config)) {
    showView('jtViewSetup');
    $('jtBtnOpenOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }
  showView('jtViewForm');
  bindForm();

  // Draft recovery
  const tab = await activeTab();
  const draft = await getDraft();
  if (draft && tab && draft.tabUrl === tab.url) {
    restoreDraft(draft);
    dirty = true;
    const hint = $('jtScrapeHint');
    if (hint) hint.textContent = '已恢复未保存的草稿';
  } else {
    await refreshFromTab();
  }

  // Watch tab switches
  tabActivatedListener = () => onTabChanged();
  tabUpdatedListener = (_tabId, changeInfo, t) => {
    if (changeInfo.status === 'complete' && t.active) onTabChanged();
  };
  chrome.tabs.onActivated.addListener(tabActivatedListener);
  chrome.tabs.onUpdated.addListener(tabUpdatedListener);

  // Update check
  showUpdateIfAvailable();
  const dismissBtn = $('jtUpdateDismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', () => dismissUpdate());
}

export function destroy() {
  if (tabActivatedListener) chrome.tabs.onActivated.removeListener(tabActivatedListener);
  if (tabUpdatedListener) chrome.tabs.onUpdated.removeListener(tabUpdatedListener);
  tabActivatedListener = null;
  tabUpdatedListener = null;
  container = null;
}

// ============ Tab Change ============
async function onTabChanged() {
  if (dirty) {
    const hint = $('jtScrapeHint');
    if (hint) hint.textContent = '页面已变化，可点「↻ 重新抓取」带入当前页信息';
    return;
  }
  await refreshFromTab();
}

// ============ Scrape ============
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refreshFromTab() {
  resetForm();
  const tab = await activeTab();
  const tabUrl = (tab && tab.url) || '';
  if (!/^https?:\/\//.test(tabUrl)) {
    const hint = $('jtScrapeHint');
    if (hint) hint.textContent = '当前页面无法抓取，请手动填写';
    return;
  }
  const urlEl = $('jtUrl');
  if (urlEl) urlEl.value = tabUrl;
  await scrapePage(tab.id);
  await checkDuplicate();
  dirty = false;
}

async function scrapePage(tabId) {
  let result = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/scraper.js']
    });
    result = injection && injection.result;
  } catch { /* restricted page */ }

  const hint = $('jtScrapeHint');
  if (!result) {
    if (hint) hint.textContent = '未能抓取页面信息，请手动填写';
    return;
  }
  pageTitle = result.pageTitle || '';
  if (result.company) { const el = $('jtCompany'); if (el) el.value = result.company; }
  if (result.position) { const el = $('jtPosition'); if (el) el.value = result.position; }
  if (result.url) { const el = $('jtUrl'); if (el) el.value = result.url; }

  const LOW = new Set(['hostname', 'fallback']);
  const compEl = $('jtCompany');
  const posEl = $('jtPosition');
  if (compEl) compEl.classList.toggle('jt-low-confidence', LOW.has(result.confidence.company));
  if (posEl) posEl.classList.toggle('jt-low-confidence', LOW.has(result.confidence.position));
  if (hint) {
    hint.textContent = LOW.has(result.confidence.company) || LOW.has(result.confidence.position)
      ? '橙色字段为推测值，请核对' : '已抓取当前页面信息';
  }
}

async function checkDuplicate() {
  const banner = $('jtDupBanner');
  banner.classList.add('hidden');
  const urlEl = $('jtUrl');
  const url = urlEl ? urlEl.value.trim() : '';
  if (!url) return;
  const dup = await findDuplicate(url);
  if (dup) {
    const days = Math.floor((Date.now() - dup.appliedAt) / 86400000);
    const when = days <= 0 ? '今天' : `${days} 天前`;
    banner.textContent = `⚠ ${when}已投递过此链接（${dup.company} · ${dup.position}）`;
    banner.classList.remove('hidden');
  }
}

// ============ Form ============
function bindForm() {
  $('jtBtnSave').addEventListener('click', onSave);
  $('jtBtnSaveLocal').addEventListener('click', onSaveLocal);
  $('jtBtnRescrape').addEventListener('click', async () => {
    await clearDraft();
    dirty = false;
    await refreshFromTab();
  });
  $('jtLinkOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  FORM_IDS.forEach(id => {
    const el = document.getElementById(id); // these are unique IDs, document.getElementById is fine
    if (el) {
      el.addEventListener('input', onUserEdit);
      el.addEventListener('change', onUserEdit);
    }
  });
}

async function onUserEdit() {
  dirty = true;
  const tab = await activeTab();
  const values = {};
  FORM_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) values[id] = el.value;
  });
  await saveDraft({ tabUrl: (tab && tab.url) || '', pageTitle, values });
}

function restoreDraft(draft) {
  pageTitle = draft.pageTitle || '';
  FORM_IDS.forEach(id => {
    if (draft.values && draft.values[id] !== undefined) {
      const el = document.getElementById(id);
      if (el) el.value = draft.values[id];
    }
  });
}

function resetForm() {
  ['jtCompany','jtPosition','jtUrl','jtNote'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const timeEl = document.getElementById('jtTime');
  if (timeEl) timeEl.value = toLocalInputValue(new Date());
  const statusEl = document.getElementById('jtStatus');
  if (statusEl) statusEl.value = '已投递';
  ['jtCompany','jtPosition'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('jt-low-confidence');
  });
  const dupBanner = $('jtDupBanner');
  if (dupBanner) dupBanner.classList.add('hidden');
  const msgEl = $('jtMsg');
  if (msgEl) { msgEl.className = 'msg hidden'; }
  const saveBtn = $('jtBtnSave');
  if (saveBtn) saveBtn.textContent = '保存到飞书';
  const saveLocalBtn = $('jtBtnSaveLocal');
  if (saveLocalBtn) saveLocalBtn.classList.add('hidden');
  const hint = $('jtScrapeHint');
  if (hint) hint.textContent = '';
  pageTitle = '';
}

function collectRecord() {
  const getVal = (suffix) => {
    const el = document.getElementById('jt' + suffix);
    return el ? el.value.trim() : '';
  };
  const company = getVal('Company');
  const position = getVal('Position');
  return {
    company,
    position,
    appliedAt: (() => {
      const el = document.getElementById('jtTime');
      return el && el.value ? new Date(el.value).getTime() : Date.now();
    })(),
    url: getVal('Url'),
    linkText: pageTitle || [company, position].filter(Boolean).join(' · '),
    status: (() => { const el = document.getElementById('jtStatus'); return el ? el.value : '已投递'; })(),
    note: getVal('Note')
  };
}

// ============ Save ============
async function onSave() {
  const record = collectRecord();
  if (!record.company && !record.position) {
    showMsg('公司和岗位至少填一项', 'error');
    return;
  }
  setBusy(true, '同步中…');
  const resp = await chrome.runtime.sendMessage({ type: 'JT_SAVE_RECORD', record });
  setBusy(false);
  if (resp && resp.ok) {
    await clearDraft();
    dirty = false;
    showMsg('✓ 已同步到飞书', 'success');
    const hint = $('jtScrapeHint');
    if (hint) hint.textContent = '打开下一个岗位页面会自动带入新信息';
  } else {
    showMsg((resp && resp.error) || '保存失败，请重试', 'error');
    const saveBtn = $('jtBtnSave');
    if (saveBtn) saveBtn.textContent = '重试';
    const saveLocalBtn = $('jtBtnSaveLocal');
    if (saveLocalBtn) saveLocalBtn.classList.remove('hidden');
  }
}

async function onSaveLocal() {
  const record = collectRecord();
  const resp = await chrome.runtime.sendMessage({ type: 'JT_SAVE_LOCAL', record });
  if (resp && resp.ok) {
    await clearDraft();
    dirty = false;
    showMsg('✓ 已保存到本地，可稍后在设置页重试同步', 'success');
  } else {
    showMsg('本地保存失败', 'error');
  }
}

// ============ Utils ============
function showView(viewId) {
  container.querySelectorAll('.jt-view').forEach(v => v.classList.add('hidden'));
  const el = container.querySelector('#' + viewId);
  if (el) el.classList.remove('hidden');
}

function showMsg(text, kind) {
  const msg = $('jtMsg');
  msg.textContent = text;
  msg.className = 'msg ' + kind;
}

function setBusy(busy, label) {
  const btn = $('jtBtnSave');
  btn.disabled = busy;
  btn.textContent = busy ? label : '保存到飞书';
}

function toLocalInputValue(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============ Update ============
async function showUpdateIfAvailable() {
  const resp = await chrome.runtime.sendMessage({ type: 'JT_CHECK_UPDATE' });
  if (!resp || !resp.hasUpdate || !resp.info) return;
  if (resp.info.version === dismissedVersion) return;
  const banner = $('jtUpdateBanner');
  $('jtUpdateVersion').textContent = 'v' + resp.info.version;
  const body = (resp.info.body || '').replace(/\r/g, '').trim();
  $('jtUpdateBody').textContent = body.length > 200 ? body.slice(0, 200) + '…' : body;
  const link = $('jtUpdateLink');
  if (link) link.href = resp.info.url || '#';
  banner.classList.remove('hidden');
}

async function dismissUpdate() {
  const resp = await chrome.runtime.sendMessage({ type: 'JT_CHECK_UPDATE' });
  if (resp && resp.info) {
    dismissedVersion = resp.info.version;
    await chrome.runtime.sendMessage({ type: 'JT_DISMISS_UPDATE', version: resp.info.version });
  }
  const banner = $('jtUpdateBanner');
  if (banner) banner.classList.add('hidden');
}
