// ================================================================
// JobHub — Side Panel Tab Router
// 惰性初始化：首次切换到某个 Tab 时才加载其模块
// 切换时调用当前模块的 destroy() 清理 listeners/intervals
// ================================================================

const TABS = {
  'resume-fill': { module: null, init: null, destroy: null },
  'job-tracker': { module: null, init: null, destroy: null },
  'dashboard':   { module: null, init: null, destroy: null }
};

let currentTab = null;

// ---------- Bootstrap ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Tab clicks
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Footer: help modal
  document.getElementById('jhBtnHelp').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('jhHelpModal').classList.remove('hidden');
  });
  document.getElementById('jhHelpClose').addEventListener('click', () => {
    document.getElementById('jhHelpModal').classList.add('hidden');
  });
  document.getElementById('jhHelpModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('jhHelpModal').classList.add('hidden');
  });

  // Footer: open options
  document.getElementById('jhBtnOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Reset all data
  document.getElementById('jhResetAll').addEventListener('click', async () => {
    if (!confirm('⚠️ 确定初始化所有数据？\n\n将清空：\n· 所有简历数据\n· 投递历史\n· 表单草稿\n· 飞书凭证\n· AI 配置\n\n不影响飞书表格中已同步的数据。\n\n此操作不可恢复！')) return;
    if (!confirm('再次确认：初始化后所有本地数据将永久丢失。确定继续？')) return;

    const { STORAGE_KEYS } = await import('../lib/constants.js');
    await chrome.storage.local.remove([
      STORAGE_KEYS.config, STORAGE_KEYS.history, STORAGE_KEYS.updateInfo,
      STORAGE_KEYS.profiles, STORAGE_KEYS.activeProfileId, 'af_ai_config'
    ]);
    await chrome.storage.session.remove([
      STORAGE_KEYS.draft, STORAGE_KEYS.token, STORAGE_KEYS.updateDismissed
    ]);
    document.getElementById('jhHelpModal').classList.add('hidden');
    // Reload current tab to pick up fresh default data
    if (TABS[currentTab] && TABS[currentTab].destroy) {
      try { TABS[currentTab].destroy(); } catch(e) {}
    }
    TABS[currentTab] = { module: null, init: null, destroy: null };
    await switchTab(currentTab);
  });

  // Load default tab
  await switchTab('resume-fill');
});

// ---------- Tab Switching ----------
async function switchTab(target) {
  if (target === currentTab) return;

  // Destroy current
  if (TABS[currentTab] && TABS[currentTab].destroy) {
    try { TABS[currentTab].destroy(); } catch (e) { console.warn('destroy error:', e); }
  }

  // Update tab bar
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[data-tab="${target}"]`);
  if (btn) btn.classList.add('active');

  // Hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  // Show target panel
  const panel = document.getElementById(`panel-${target}`);
  if (panel) panel.classList.add('active');

  // Init target (lazy load)
  if (!TABS[target].module) {
    await loadModule(target);
  }

  if (TABS[target].init) {
    try {
      await TABS[target].init(panel);
    } catch (e) {
      console.error(`${target} init error:`, e);
    }
  }

  currentTab = target;
}

async function loadModule(name) {
  switch (name) {
    case 'resume-fill':
      TABS[name].module = await import('./resume-fill.js');
      break;
    case 'job-tracker':
      TABS[name].module = await import('./job-tracker.js');
      break;
    case 'dashboard':
      TABS[name].module = await import('./dashboard.js');
      break;
  }
  TABS[name].init = TABS[name].module.init;
  TABS[name].destroy = TABS[name].module.destroy;
}

// Expose for dashboard empty-state "go track" button
export { switchTab };
