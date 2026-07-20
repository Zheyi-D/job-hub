// ================================================================
// JobHub — Data Dashboard Panel (求职数据看板)
// 纯 CSS 图表，零依赖。数据源：本地 jt_history + 飞书远程同步
// ================================================================
import { getHistory } from '../lib/storage.js';
import { STATUS_OPTIONS, INTERVIEW_STATUSES, CLOSED_STATUSES, DASHBOARD_COLORS } from '../lib/constants.js';

let container, currentHistory = [], syncInfo = null;

// ============ Init / Destroy ============
export async function init(containerEl) {
  container = containerEl;
  currentHistory = await getHistory();
  syncInfo = null;
  render();
}

export function destroy() {
  container = null;
}

// ============ Render ============
async function render() {
  const history = currentHistory;

  if (history.length === 0) {
    renderEmpty();
    return;
  }

  const stats = computeStats(history);
  const statusDist = computeStatusDist(history);
  const trend = computeTrend(history);

  const syncInfoEl = syncInfo
    ? `<span class="db-sync-status">已同步 · ${formatSyncTime(syncInfo.fetchedAt)}</span>`
    : `<span class="db-sync-status db-sync-local">仅本地数据</span>`;

  container.innerHTML = `
    <div class="db-header">
      <h2 class="section-title" style="margin:0;border:none;padding:0;">📊 求职数据看板</h2>
      <div class="db-header-actions">
        ${syncInfoEl}
        <button class="btn btn-sm" id="dbSyncBtn">🔄 同步飞书</button>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="db-stat-grid">
      ${statCard('总投递', stats.total, '', 'var(--black)', 'var(--white)')}
      ${statCard('进行中', stats.active, '', 'var(--yellow)', 'var(--black)')}
      ${statCard('面试中', stats.interviewing, '', 'var(--purple)', 'var(--white)')}
      ${statCard('Offer', stats.offer, '', 'var(--green)', 'var(--black)')}
    </div>

    <!-- Status Distribution -->
    <div class="card" style="margin-top:16px;">
      <h3 class="db-chart-title">状态分布</h3>
      <div class="db-bar-chart">
        ${statusDist.map(d => barRow(d.label, d.count, d.pct, d.color)).join('')}
      </div>
    </div>

    <!-- 7-Day Trend -->
    <div class="card" style="margin-top:16px;">
      <h3 class="db-chart-title">近 7 天投递趋势</h3>
      <div class="db-trend-chart">
        ${trend.map(d => trendBar(d.day, d.count, d.height, d.label)).join('')}
      </div>
      <div class="db-trend-labels">
        ${trend.map(d => `<span>${d.label}</span>`).join('')}
      </div>
    </div>
  `;

  // Bind sync button
  const syncBtn = container.querySelector('#dbSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', doSync);
  }
}

function renderEmpty() {
  container.innerHTML = `
    <div class="db-header">
      <h2 class="section-title" style="margin:0;border:none;padding:0;">📊 求职数据看板</h2>
      <button class="btn btn-sm" id="dbSyncBtn">🔄 同步飞书</button>
    </div>
    <div class="empty-state">
      <span class="empty-icon">📊</span>
      <span class="empty-title">还没有投递记录</span>
      <span class="empty-desc">去「投递追踪」Tab 记录你的第一份投递吧</span>
      <button class="btn btn-primary" id="dbGoTrack">开始记录投递 →</button>
    </div>
  `;

  const syncBtn = container.querySelector('#dbSyncBtn');
  if (syncBtn) syncBtn.addEventListener('click', doSync);

  const goTrack = container.querySelector('#dbGoTrack');
  if (goTrack) goTrack.addEventListener('click', async () => {
    const { switchTab } = await import('./sidepanel.js');
    switchTab('job-tracker');
  });
}

// ============ Sync ============

async function doSync() {
  const syncBtn = container.querySelector('#dbSyncBtn');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.textContent = '⏳ 同步中…';
  }

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'JT_FETCH_REMOTE' });
    if (resp && resp.ok && resp.history) {
      // Merge: remote records + local-only records (not yet synced to feishu)
      const localHistory = await getHistory();
      const localOnly = localHistory.filter(h => h.syncState === 'local-only');

      // Deduplicate local-only against remote (by URL)
      const remoteUrls = new Set(resp.history.map(h => h.normalizedUrl).filter(Boolean));
      const uniqueLocal = localOnly.filter(h => !remoteUrls.has(h.normalizedUrl));

      // Remote first, then unique local
      currentHistory = [...resp.history, ...uniqueLocal];
      syncInfo = { fetchedAt: resp.fetchedAt };
      render();
    } else {
      const msg = (resp && resp.error) || '同步失败';
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.textContent = '🔄 同步飞书';
      }
      // Brief toast-like feedback via sync button
      if (syncBtn) {
        syncBtn.textContent = '❌ ' + msg;
        setTimeout(() => { syncBtn.textContent = '🔄 同步飞书'; syncBtn.disabled = false; }, 2000);
      }
    }
  } catch (err) {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.textContent = '🔄 重试';
    }
  }
}

function formatSyncTime(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============ Compute ============
function computeStats(history) {
  const total = history.length;
  const active = history.filter(h => !CLOSED_STATUSES.has(h.statusValue)).length;
  const interviewing = history.filter(h => INTERVIEW_STATUSES.has(h.statusValue)).length;
  const offer = history.filter(h => h.statusValue === 'Offer').length;
  return { total, active, interviewing, offer };
}

function computeStatusDist(history) {
  const total = history.length;
  const counts = {};
  STATUS_OPTIONS.forEach(s => { counts[s] = 0; });
  history.forEach(h => {
    if (counts[h.statusValue] !== undefined) counts[h.statusValue]++;
    else counts[h.statusValue] = 1;
  });

  return Object.entries(counts)
    .filter(([,c]) => c > 0)
    .map(([label, count]) => {
      const pct = Math.round((count / total) * 100);
      const color = statusColor(label);
      return { label, count, pct, color };
    });
}

function statusColor(status) {
  if (INTERVIEW_STATUSES.has(status)) return DASHBOARD_COLORS.interview;
  if (status === 'Offer') return DASHBOARD_COLORS.offer;
  if (status === '已挂' || status === '已拒绝') return DASHBOARD_COLORS.rejected;
  if (status === '测评' || status === '笔试') return DASHBOARD_COLORS.testing;
  return DASHBOARD_COLORS.applied;
}

function computeTrend(history) {
  const days = [];
  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);

    const count = history.filter(h => {
      const t = h.appliedAt;
      return t >= d.getTime() && t <= dEnd.getTime();
    }).length;

    days.push({
      day: d.getDay(),
      label: dayNames[d.getDay()],
      date: d,
      count
    });
  }

  const max = Math.max(...days.map(d => d.count), 1);
  return days.map(d => ({
    ...d,
    height: Math.round((d.count / max) * 100),
    isToday: new Date().getDay() === d.day && d.date.getDate() === new Date().getDate()
  }));
}

// ============ HTML Generators ============
function statCard(title, value, subtitle, bg, color) {
  return `
    <div class="db-stat-card" style="background:${bg};color:${color};">
      <div class="db-stat-value">${value}</div>
      <div class="db-stat-title">${title}</div>
      ${subtitle ? `<div class="db-stat-sub">${subtitle}</div>` : ''}
    </div>
  `;
}

function barRow(label, count, pct, color) {
  return `
    <div class="db-bar-row">
      <span class="db-bar-label">${label}</span>
      <div class="db-bar-track">
        <div class="db-bar-fill" style="width:${Math.max(pct, 3)}%;background:${color};"></div>
      </div>
      <span class="db-bar-count">${count}</span>
    </div>
  `;
}

function trendBar(day, count, height, label) {
  const bg = count > 0 ? 'var(--blue)' : 'var(--bg-hover)';
  return `
    <div class="db-trend-col">
      <div class="db-trend-bar" style="height:${Math.max(height, 2)}%;background:${bg};" title="${label}: ${count}"></div>
      <span class="db-trend-count">${count}</span>
    </div>
  `;
}
