// ================================================================
// JobHub — Resume Fill Panel (简历填充面板)
// 从 auto-fill-extension/sidepanel.js 重构为 ES Module
// 新增：多份简历管理 (P1)、Neo-Brutalist 风格
// ================================================================
import {
  getProfiles, getActiveProfileId, getActiveProfile,
  saveActiveProfile, saveProfiles, setActiveProfileId,
  addProfile, deleteProfile, duplicateProfile, renameProfile
} from '../lib/storage.js';
import { getAiConfig, isAiEnabled, callAI } from '../lib/ai-client.js';
import { extractTextFromFile, extractTextFromClipboard } from '../lib/file-parsers.js';
import { matchFieldsWithAI } from '../lib/field-matcher.js';

// ============ Module State ============
let container, profile, profiles, isEditMode, activeTabId, toastTimer, focusInterval;
let modeToggle, resetBtn, focusHint, toast, categoriesEl;
let profileSelect, profileMenuBtn, profileMenuPanel, addCatBtn;
let aiParsedData = null;  // holds AI parse result for preview

const el = (id) => container ? container.querySelector('#' + id) : null;

// ============ Init / Destroy ============
export async function init(containerEl) {
  container = containerEl;

  // Cache DOM refs
  modeToggle     = el('rfModeToggle');
  resetBtn       = el('rfResetBtn');
  focusHint      = el('rfFocusHint');
  toast          = el('rfToast');
  categoriesEl   = el('rfCategories');
  profileSelect  = el('rfProfileSelect');
  profileMenuBtn = el('rfProfileMenu');
  profileMenuPanel = el('rfProfileMenuPanel');
  addCatBtn      = el('rfAddCatBtn');
  // AI & batch scan refs (may be null if elements don't exist yet — guarded in handlers)

  // Load data
  profiles = await getProfiles();
  const activeId = await getActiveProfileId();
  profile = profiles.find(p => p.id === activeId) || profiles[0];

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id;

  // Bind events
  bindEvents();

  // Disable scan button if AI not configured
  const aiConfig = await getAiConfig();
  const scanBtn2 = el('rfScanBtn');
  if (scanBtn2 && !isAiEnabled(aiConfig)) {
    scanBtn2.disabled = true;
    scanBtn2.title = '需要配置 AI API Key（设置页 → AI 配置）';
    scanBtn2.style.opacity = '0.4';
    scanBtn2.style.cursor = 'not-allowed';
  }

  // Render
  refreshProfileSelect();
  render();

  // Start focus polling
  refreshFocusHint();
  focusInterval = setInterval(refreshFocusHint, 1500);
}

export function destroy() {
  if (focusInterval) { clearInterval(focusInterval); focusInterval = null; }
  container = null;
}

// ============ Profile Selector ============
function refreshProfileSelect() {
  profileSelect.innerHTML = '';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelect.appendChild(opt);
  });
  profileSelect.value = profile.id;
}

async function switchProfile(id) {
  profile = profiles.find(p => p.id === id);
  if (!profile) return;
  await setActiveProfileId(id);
  render();
}

// ============ Event Bindings ============
function bindEvents() {
  modeToggle.addEventListener('click', toggleMode);
  resetBtn.addEventListener('click', resetProfile);

  profileSelect.addEventListener('change', () => switchProfile(profileSelect.value));

  profileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    profileMenuPanel.classList.toggle('hidden');
  });

  // Profile menu actions
  profileMenuPanel.querySelectorAll('.rf-profile-menu-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      switch (action) {
        case 'new': {
          const name = prompt('新简历名称：', '我的简历');
          if (name && name.trim()) {
            profile = await addProfile(name.trim());
            profiles = await getProfiles();
            refreshProfileSelect();
            render();
          }
          break;
        }
        case 'rename': {
          const newName = prompt('新名称：', profile.name);
          if (newName && newName.trim()) {
            await renameProfile(profile.id, newName.trim());
            profiles = await getProfiles();
            profile = profiles.find(p => p.id === profile.id);
            refreshProfileSelect();
            render();
          }
          break;
        }
        case 'duplicate': {
          profile = await duplicateProfile(profile.id);
          profiles = await getProfiles();
          refreshProfileSelect();
          render();
          break;
        }
        case 'delete': {
          if (profiles.length <= 1) {
            showToast('至少保留一份简历', 'error');
            break;
          }
          if (confirm(`确定删除「${profile.name}」？`)) {
            const ok = await deleteProfile(profile.id);
            if (ok) {
              profiles = await getProfiles();
              profile = profiles[0];
              refreshProfileSelect();
              render();
              showToast('已删除', 'success');
            }
          }
          break;
        }
      }
      profileMenuPanel.classList.add('hidden');
    });
  });

  // Close menu on outside click
  document.addEventListener('click', () => profileMenuPanel.classList.add('hidden'));

  // AI modal
  const aiBtn = el('rfAiBtn'); if (aiBtn) aiBtn.addEventListener('click', openAiModal);
  const aiClose = el('rfAiModalClose'); if (aiClose) aiClose.addEventListener('click', closeAiModal);
  const aiMod = el('rfAiModal');
  if (aiMod) aiMod.addEventListener('click', (e) => { if (e.target === aiMod) closeAiModal(); });
  const aiParse = el('rfAiParse'); if (aiParse) aiParse.addEventListener('click', doAiParse);
  const aiApply = el('rfAiApply'); if (aiApply) aiApply.addEventListener('click', () => applyAiResult(false));
  const aiApplyNew = el('rfAiApplyNew'); if (aiApplyNew) aiApplyNew.addEventListener('click', () => applyAiResult(true));
  const aiReparse = el('rfAiReparse'); if (aiReparse) aiReparse.addEventListener('click', doAiParse);

  // External link path
  const aiLinkApply = el('rfAiLinkApply'); if (aiLinkApply) aiLinkApply.addEventListener('click', () => applyExternalJson(false));
  const aiLinkApplyNew = el('rfAiLinkApplyNew'); if (aiLinkApplyNew) aiLinkApplyNew.addEventListener('click', () => applyExternalJson(true));
  const aiCopyPrompt = el('rfAiCopyPromptBtn'); if (aiCopyPrompt) aiCopyPrompt.addEventListener('click', copyAiPrompt);
  document.querySelectorAll('.rf-ext-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.url;
      if (url) chrome.tabs.create({ url, active: true });
    });
  });

  // Batch scan
  const scanBtn = el('rfScanBtn'); if (scanBtn) scanBtn.addEventListener('click', doBatchScan);
  const batchClose = el('rfBatchClose'); if (batchClose) batchClose.addEventListener('click', () => el('rfBatchPanel').classList.add('hidden'));
  const batchFillHigh = el('rfBatchFillHigh'); if (batchFillHigh) batchFillHigh.addEventListener('click', () => batchFill(true));
  const batchFillAll = el('rfBatchFillAll'); if (batchFillAll) batchFillAll.addEventListener('click', () => batchFill(false));

  // File drop zone
  const fileDrop = el('rfFileDrop');
  if (fileDrop) {
    fileDrop.addEventListener('click', () => el('rfFileInput').click());
    fileDrop.addEventListener('dragover', (e) => { e.preventDefault(); fileDrop.classList.add('drag-over'); });
    fileDrop.addEventListener('dragleave', () => fileDrop.classList.remove('drag-over'));
    fileDrop.addEventListener('drop', (e) => {
      e.preventDefault();
      fileDrop.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) handleUploadFile(file);
    });
    el('rfFileInput').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleUploadFile(file);
    });
  }
}

// ============ Render ============
function render() {
  categoriesEl.innerHTML = '';

  profile.categories.forEach((cat, catIdx) => {
    const panel = createCategoryPanel(cat, catIdx);
    categoriesEl.appendChild(panel);
  });

  // Add category button
  if (isEditMode) {
    addCatBtn.classList.remove('hidden');
  } else {
    addCatBtn.classList.add('hidden');
  }
  addCatBtn.onclick = addCategory;
}

function createCategoryPanel(cat, catIdx) {
  const panel = document.createElement('div');
  panel.className = 'rf-category-panel';
  panel.dataset.catId = cat.id;

  // Header
  const header = document.createElement('div');
  header.className = 'rf-category-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'rf-cat-icon';
  iconSpan.textContent = cat.icon;

  const nameSpan = document.createElement('span');
  nameSpan.className = 'rf-cat-name';
  nameSpan.textContent = cat.name;

  const titleSpan = document.createElement('span');
  titleSpan.className = 'rf-category-title';
  titleSpan.appendChild(iconSpan);
  titleSpan.appendChild(nameSpan);

  if (isEditMode) {
    iconSpan.style.cursor = 'pointer';
    iconSpan.title = '点击修改图标';
    iconSpan.addEventListener('click', (e) => { e.stopPropagation(); editCatIcon(iconSpan, cat); });
    nameSpan.style.cursor = 'text';
    nameSpan.title = '点击修改名称';
    nameSpan.addEventListener('click', (e) => { e.stopPropagation(); editCatName(nameSpan, cat); });
    titleSpan.addEventListener('click', (e) => {
      if (e.target === titleSpan) panel.classList.toggle('rf-collapsed');
    });
  } else {
    titleSpan.addEventListener('click', () => panel.classList.toggle('rf-collapsed'));
  }

  const actions = document.createElement('div');
  actions.className = 'rf-header-actions';
  if (isEditMode) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm';
    addBtn.textContent = '＋';
    addBtn.title = '添加字段';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); addField(catIdx); });
    actions.appendChild(addBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = '✕';
    delBtn.title = '删除分类';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteCategory(catIdx); });
    actions.appendChild(delBtn);
  }

  header.appendChild(titleSpan);
  header.appendChild(actions);
  panel.appendChild(header);

  // Field list — fill mode: compact buttons; edit mode: full rows with card grouping
  const fieldList = document.createElement('div');
  fieldList.className = isEditMode ? 'rf-field-list' : 'rf-field-list-fill';

  if (!isEditMode) {
    // Fill mode: only show non-empty fields as compact tag buttons
    const groups = groupFields(cat.fields);
    if (groups.length <= 1) {
      cat.fields.forEach((field, i) => {
        if (field.value && field.value.trim()) {
          fieldList.appendChild(createFillButton(cat, catIdx, field, i));
        }
      });
    } else {
      groups.forEach(grp => {
        const hasContent = grp.fields.some(f => f.value && f.value.trim());
        if (!hasContent) return;
        const card = document.createElement('div');
        card.className = 'rf-group-card';
        card.style.padding = '4px';
        if (grp.label) {
          const cardHead = document.createElement('div');
          cardHead.className = 'rf-group-card-head';
          cardHead.textContent = grp.label;
          card.appendChild(cardHead);
        }
        grp.fields.forEach(f => {
          const idx = cat.fields.indexOf(f);
          if (f.value && f.value.trim()) {
            card.appendChild(createFillButton(cat, catIdx, f, idx));
          }
        });
        fieldList.appendChild(card);
      });
    }
  } else {
    // Edit mode: show all fields with full rows (current behavior)
    const groups = groupFields(cat.fields);
    if (groups.length <= 1) {
      cat.fields.forEach((field, i) => fieldList.appendChild(createFieldRow(cat, catIdx, field, i)));
    } else {
      groups.forEach(grp => {
        const card = document.createElement('div');
        card.className = 'rf-group-card';
        if (grp.label) {
          const cardHead = document.createElement('div');
          cardHead.className = 'rf-group-card-head';
          cardHead.textContent = grp.label;
          if (isEditMode) {
            cardHead.title = '点击编辑标题';
            cardHead.addEventListener('click', () => {
              const newVal = prompt('修改标题', grp.label);
              if (newVal && newVal.trim()) {
                grp.fields[0].value = newVal.trim();
                grp.label = newVal.trim();
                cardHead.textContent = newVal.trim();
                saveData();
              }
            });
          }
          card.appendChild(cardHead);
        }
        grp.fields.forEach(f => {
          const idx = cat.fields.indexOf(f);
          card.appendChild(createFieldRow(cat, catIdx, f, idx));
        });
        fieldList.appendChild(card);
      });
    }
  }

  panel.appendChild(fieldList);

  // "添加经历" button for internship/project types in edit mode
  const isExperiences = cat.id === 'internship' || cat.id === 'project' || cat.id === 'campus' || cat.id === 'education';
  if (isEditMode && isExperiences) {
    const label = cat.id === 'education' ? '+ 添加学历' : '+ 添加经历';
    const addExpBtn = document.createElement('button');
    addExpBtn.className = 'btn btn-sm rf-add-exp';
    addExpBtn.textContent = label;
    addExpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      addExperience(cat, catIdx);
    });
    panel.appendChild(addExpBtn);
  }

  return panel;
}

function createFieldRow(cat, catIdx, field, fieldIdx) {
  const row = document.createElement('div');
  row.className = 'rf-field-row';

  if (isEditMode) {
    const grip = document.createElement('span');
    grip.className = 'rf-drag-grip';
    grip.textContent = '⠿';
    grip.title = '拖拽排序';
    row.appendChild(grip);
  }

  const labelEl = document.createElement('span');
  labelEl.className = 'rf-field-label';
  labelEl.textContent = field.label;

  const valueEl = document.createElement('span');
  valueEl.className = 'rf-field-value';
  valueEl.textContent = field.value || '(空)';
  valueEl.title = field.value;
  if (!field.value) valueEl.style.cssText = 'color:var(--text-secondary);font-style:italic;min-height:18px;';

  row.appendChild(labelEl);
  row.appendChild(valueEl);

  if (!isEditMode) {
    row.classList.add('rf-fill-mode');
    row.addEventListener('click', () => handleFill(field.value, row));
  } else {
    row.classList.add('rf-edit-mode');
    row.draggable = true;
    row.dataset.catIdx = catIdx;
    row.dataset.fieldIdx = fieldIdx;
    row.addEventListener('dragstart', handleDragStart);
    row.addEventListener('dragend', handleDragEnd);
    row.addEventListener('dragover', handleDragOver);
    row.addEventListener('drop', handleDrop);
    row.addEventListener('dragleave', handleDragLeave);

    labelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineEdit(labelEl, field, 'label', catIdx, fieldIdx);
    });
    valueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineEdit(valueEl, field, 'value', catIdx, fieldIdx);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.style.cssText = 'padding:2px 6px;font-size:11px;';
    delBtn.textContent = '×';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteField(catIdx, fieldIdx); });
    row.appendChild(delBtn);
  }

  return row;
}

// Fill mode: compact button showing only the label
function createFillButton(cat, catIdx, field, fieldIdx) {
  const btn = document.createElement('button');
  btn.className = 'rf-fill-btn';
  // Show label only — no value visible in fill mode
  btn.textContent = field.label;
  btn.title = field.value; // visible on hover
  btn.addEventListener('click', () => handleFill(field.value, btn));
  return btn;
}

// ============ Drag & Drop ============
let dragSrcCat, dragSrcField;

function handleDragStart() {
  dragSrcCat = parseInt(this.dataset.catIdx);
  dragSrcField = parseInt(this.dataset.fieldIdx);
  this.classList.add('rf-dragging');
  this.style.opacity = '0.4';
}

function handleDragEnd() {
  this.classList.remove('rf-dragging');
  this.style.opacity = '';
  dragSrcCat = null; dragSrcField = null;
  document.querySelectorAll('.rf-field-row.rf-drop-target').forEach(el => el.classList.remove('rf-drop-target'));
}

function handleDragOver(e) {
  e.preventDefault();
  const tc = parseInt(this.dataset.catIdx);
  if (tc !== dragSrcCat) return;
  document.querySelectorAll('.rf-field-row.rf-drop-target').forEach(el => el.classList.remove('rf-drop-target'));
  this.classList.add('rf-drop-target');
}

function handleDragLeave() { this.classList.remove('rf-drop-target'); }

function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('rf-drop-target');
  const tc = parseInt(this.dataset.catIdx);
  const tf = parseInt(this.dataset.fieldIdx);
  if (tc !== dragSrcCat || dragSrcField === tf || dragSrcField == null || tf == null) return;
  const cat = profile.categories[tc];
  const [moved] = cat.fields.splice(dragSrcField, 1);
  cat.fields.splice(tf, 0, moved);
  saveData(); render();
}

// ============ Inline Edit ============
function startInlineEdit(el, field, key, catIdx, fieldIdx) {
  if (el.querySelector('input, textarea')) return;
  const original = field[key];
  const isMultiline = key === 'value';
  const editor = document.createElement(isMultiline ? 'textarea' : 'input');
  if (!isMultiline) editor.type = 'text';
  editor.className = 'rf-inline-editor';
  editor.value = original;
  if (isMultiline) { editor.rows = 2; editor.style.resize = 'vertical'; }
  el.textContent = '';
  el.appendChild(editor);
  editor.focus();
  editor.select();

  function save() {
    let newVal = editor.value;
    if (!isMultiline) newVal = newVal.trim();
    if (newVal !== original) {
      field[key] = newVal;
      saveData();
      el.textContent = newVal;
    } else {
      el.textContent = original;
    }
  }

  editor.addEventListener('blur', save);
  editor.addEventListener('keydown', (e) => {
    if (isMultiline) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); editor.blur(); }
      if (e.key === 'Escape') { editor.value = original; editor.blur(); }
    } else {
      if (e.key === 'Enter') { e.preventDefault(); editor.blur(); }
      if (e.key === 'Escape') { editor.value = original; editor.blur(); }
    }
  });
}

function editCatName(el, cat) {
  if (el.querySelector('input')) return;
  const original = cat.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rf-inline-editor';
  input.value = original;
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
  function save() {
    const v = input.value.trim();
    if (v && v !== original) { cat.name = v; saveData(); el.textContent = v; }
    else el.textContent = original;
  }
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = original; input.blur(); }
  });
}

function editCatIcon(el, cat) {
  if (el.querySelector('input')) return;
  const original = cat.icon;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rf-inline-editor';
  input.value = original;
  input.maxLength = 2;
  el.textContent = '';
  el.appendChild(input);
  input.focus(); input.select();
  function save() {
    const v = input.value.trim() || original;
    if (v !== original) { cat.icon = v; saveData(); el.textContent = v; }
    else el.textContent = original;
  }
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
    if (e.key === 'Escape') { input.value = original; input.blur(); }
  });
}

// ============ Add/Delete ============
function addField(catIdx) {
  profile.categories[catIdx].fields.push({ label: '新字段', value: '' });
  saveData(); render();
}

function deleteField(catIdx, fieldIdx) {
  profile.categories[catIdx].fields.splice(fieldIdx, 1);
  saveData(); render();
}

// Add a new experience block (internship or project)
function addExperience(cat, catIdx) {
  // Find next number
  let maxN = 0;
  cat.fields.forEach(f => {
    const m = f.label.match(/(\d+)/);
    if (m) { const n = parseInt(m[1], 10); if (n > maxN) maxN = n; }
  });
  const n = maxN + 1;

  if (cat.id === 'education') {
    cat.fields.push(
      { label: `学校${n}`, value: '' }, { label: `学位${n}`, value: '' },
      { label: `专业${n}`, value: '' }, { label: `时间${n}`, value: '' },
      { label: `GPA ${n}`, value: '' }, { label: `荣誉${n}`, value: '' },
      { label: `课程${n}`, value: '' }
    );
  } else if (cat.id === 'internship') {
    cat.fields.push(
      { label: `公司${n}`, value: '' },
      { label: `岗位${n}`, value: '' },
      { label: `时间${n}`, value: '' },
      { label: `描述${n}`, value: '' }
    );
  } else if (cat.id === 'project') {
    cat.fields.push(
      { label: `项目${n}`, value: '' },
      { label: `角色${n}`, value: '' },
      { label: `描述${n}`, value: '' }
    );
  } else if (cat.id === 'campus') {
    cat.fields.push(
      { label: `组织/活动${n}`, value: '' },
      { label: `角色${n}`, value: '' },
      { label: `描述${n}`, value: '' }
    );
  }
  saveData(); render();
}

function addCategory() {
  profile.categories.push({ id: 'cat_' + Date.now(), name: '新分类', icon: '📌', fields: [{ label: '新字段', value: '' }] });
  saveData(); render();
}

function deleteCategory(catIdx) {
  if (profile.categories.length <= 1) { showToast('至少保留一个分类', 'error'); return; }
  profile.categories.splice(catIdx, 1);
  saveData(); render();
}

// ============ Fill Logic ============
async function handleFill(value, rowEl) {
  if (!activeTabId) { showToast('无法获取当前页面', 'error'); return; }
  try {
    const resp = await chrome.tabs.sendMessage(activeTabId, { type: 'FILL', value });
    if (resp && resp.success) {
      rowEl.classList.add('rf-filled');
      showToast('✅ 已填入', 'success');
      setTimeout(() => rowEl.classList.remove('rf-filled'), 1200);
    } else {
      showToast('❌ ' + (resp ? resp.error : '填充失败'), 'error');
      rowEl.classList.add('rf-fill-error');
      setTimeout(() => rowEl.classList.remove('rf-fill-error'), 600);
    }
  } catch {
    showToast('⚠️ 当前页面不支持填充', 'error');
    rowEl.classList.add('rf-fill-error');
    setTimeout(() => rowEl.classList.remove('rf-fill-error'), 600);
  }
}

// ============ Focus Hint ============
async function refreshFocusHint() {
  if (!activeTabId) return;
  try {
    const resp = await chrome.tabs.sendMessage(activeTabId, { type: 'CHECK_FOCUS' });
    if (resp && resp.hasFocus) {
      let info = resp.tag;
      if (resp.type) info += '[' + resp.type + ']';
      if (resp.placeholder) info += ' → ' + resp.placeholder;
      if (resp.id) info += ' #' + resp.id;
      focusHint.textContent = '📍 已聚焦: ' + info;
      focusHint.className = 'rf-focus-hint rf-focus-ready';
    } else {
      focusHint.textContent = '👆 请先在网页上点击要填入的输入框';
      focusHint.className = 'rf-focus-hint';
    }
  } catch {
    if (activeTabId) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId },
          files: ['content/fill-engine.js']
        });
        focusHint.textContent = '👆 请先在网页上点击要填入的输入框';
        focusHint.className = 'rf-focus-hint';
      } catch {
        focusHint.textContent = '🔒 当前页面不支持（系统页面）';
        focusHint.className = 'rf-focus-hint rf-focus-error';
      }
    }
  }
}

// ============ Mode Toggle ============
function toggleMode() {
  if (isEditMode) {
    // Exiting edit mode — save
    saveData();
    showToast('✅ 已保存', 'success');
  }
  isEditMode = !isEditMode;
  if (isEditMode) {
    modeToggle.textContent = '💾 保存';
    modeToggle.className = 'btn btn-sm btn-primary';
  } else {
    modeToggle.textContent = '✏️ 编辑';
    modeToggle.className = 'btn btn-sm';
  }
  render();
}

// ============ Reset ============
async function resetProfile() {
  if (!confirm('确定重置当前简历？所有编辑将丢失。')) return;
  const { createEmptyProfile } = await import('../lib/constants.js');
  const fresh = createEmptyProfile(profile.name);
  fresh.id = profile.id;
  fresh.createdAt = profile.createdAt;
  fresh.updatedAt = Date.now();
  profile = fresh;
  await saveData();
  render();
  showToast('✅ 已重置', 'success');
}

// ============ Persistence ============
async function saveData() {
  profile.updatedAt = Date.now();
  // Update profile in profiles array
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) profiles[idx] = profile;
  await saveActiveProfile(profile);
}

// ============ Helpers ============
function groupFields(fields) {
  const groups = [];
  let current = null;
  fields.forEach(f => {
    const gid = getGroupNumber(f.label) || -1;
    if (!current || current.id !== gid) {
      current = { id: gid, fields: [], label: null };
      groups.push(current);
    }
    if (!current.label && gid > 0) current.label = f.value;
    current.fields.push(f);
  });
  return groups;
}

function getGroupNumber(label) {
  const m = label.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function showToast(msg, kind) {
  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.className = 'toast toast-' + (kind || 'info') + ' visible';
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 1800);
}

// ============ AI Modal ============

async function openAiModal() {
  const modal = el('rfAiModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  // Show/hide auto-parse section based on API key
  const aiConfig = await getAiConfig();
  const uploadSection = el('rfAiPathUpload');
  if (uploadSection) uploadSection.style.display = isAiEnabled(aiConfig) ? '' : 'none';

  // Always show external AI section
  refreshAiPrompt();
}

function closeAiModal() {
  const modal = el('rfAiModal');
  if (modal) modal.classList.add('hidden');
  aiParsedData = null;
  const preview = el('rfAiPreview'); if (preview) preview.classList.add('hidden');
  const progress = el('rfAiProgress'); if (progress) progress.classList.add('hidden');
  const msg = el('rfAiMsg'); if (msg) msg.className = 'msg hidden';
  const fileInfo = el('rfFileInfo'); if (fileInfo) { fileInfo.classList.add('hidden'); fileInfo.textContent = ''; }
}

// ============ File Upload & AI Parse (Path A) ============

async function handleUploadFile(file) {
  const fileInfo = el('rfFileInfo');
  fileInfo.classList.remove('hidden');
  fileInfo.textContent = `已选择: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;

  // Clear paste text (one source at a time)
  const pasteText = el('rfPasteText');
  if (pasteText) pasteText.value = '';
}

async function doAiParse() {
  const progress = el('rfAiProgress');
  const msg = el('rfAiMsg');
  msg.className = 'msg hidden';
  progress.classList.remove('hidden');
  progress.innerHTML = '⏳ 正在读取文件...';

  try {
    let resumeText = '';
    const fileInput = el('rfFileInput');
    const pasteEl = el('rfPasteText');
    const hasPaste = pasteEl && pasteEl.value.trim();

    // Paste text takes priority when present (avoids stale file from previous attempt)
    if (hasPaste) {
      resumeText = extractTextFromClipboard(pasteEl.value);
      progress.innerHTML = `✓ 文本读取完成 (${resumeText.length} 字符)<br>⏳ AI 正在分析...`;
    } else if (fileInput && fileInput.files && fileInput.files[0]) {
      progress.innerHTML = '✓ 文件读取完成<br>⏳ 正在提取文本...';
      const result = await extractTextFromFile(fileInput.files[0]);
      resumeText = result.text;
      progress.innerHTML = `✓ 文件读取完成 (.${result.ext})<br>✓ 文本提取完成 (${result.charCount} 字符)<br>⏳ AI 正在分析...`;
    } else {
      msg.className = 'msg error';
      msg.textContent = '请先选择文件或粘贴简历文本';
      progress.classList.add('hidden');
      return;
    }

    if (!resumeText || resumeText.length < 20) {
      msg.className = 'msg error';
      msg.textContent = '未能提取到足够的文本内容，请检查文件是否损坏或为空';
      progress.classList.add('hidden');
      // Clear stale file input so next attempt doesn't reuse it
      if (fileInput) fileInput.value = '';
      return;
    }

    // Call AI
    const schemaJson = buildResumeSchema();
    const systemPrompt = `你是一位负责拷贝粘贴的助手。你要做的就是把简历原文中的内容原封不动搬到 JSON 里。\n\n铁律：\n1. 一字不改。简历写什么你就填什么，不要润色、不要总结、不要删减、不要改写\n2. 严格按照 JSON schema，不要增删字段\n3. 经历按编号顺序填入（公司1、公司2...），多段经历用不同编号\n4. 描述字段把原文整段搬进去，不要提炼\n5. 简历中没有对应信息的字段留空字符串""\n6. 仅输出有效 JSON，不要其他文字`;

    const userMessage = `简历原文：\n\n${resumeText}\n\n请按以下 JSON schema 输出：\n\`\`\`json\n${JSON.stringify(schemaJson, null, 2)}\n\`\`\``;

    const aiResponse = await callAI({ systemPrompt, userMessage });

    // Parse JSON from response
    let jsonStr = aiResponse;
    const m = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) jsonStr = m[1].trim();

    let data;
    try {
      data = JSON.parse(jsonStr);
    } catch (e) {
      // Try harder: find first { and last }
      const start = jsonStr.indexOf('{');
      const end = jsonStr.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { data = JSON.parse(jsonStr.slice(start, end + 1)); } catch {}
      }
      if (!data) throw new Error('AI 返回的 JSON 格式有误，请重试');
    }

    if (!data.categories || !Array.isArray(data.categories)) {
      throw new Error('AI 返回的数据缺少 categories 数组');
    }

    aiParsedData = data;
    progress.classList.add('hidden');

    // Show preview
    renderAiPreview(data);
    el('rfAiPreview').classList.remove('hidden');

  } catch (err) {
    progress.classList.add('hidden');
    msg.className = 'msg error';
    msg.textContent = err.message || '解析失败，请重试';
    // Clear stale file so paste works on retry
    const fileInput = el('rfFileInput');
    if (fileInput) fileInput.value = '';
  }
}

function buildResumeSchema() {
  return {
    name: profile.name,
    categories: profile.categories.map(cat => ({
      id: cat.id,
      name: cat.name,
      icon: cat.icon,
      fields: cat.fields.map(f => ({ label: f.label, value: '' }))
    }))
  };
}

function renderAiPreview(data) {
  const list = el('rfAiPreviewList');
  list.innerHTML = '';
  (data.categories || []).forEach(cat => {
    const filledFields = cat.fields.filter(f => f.value && f.value.trim());
    if (filledFields.length === 0) return;

    const catDiv = document.createElement('div');
    catDiv.style.cssText = 'margin-bottom:8px;';
    catDiv.innerHTML = `<b>${cat.icon} ${cat.name}</b>`;

    filledFields.forEach(f => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;padding:2px 0;font-family:monospace;font-size:11px;';
      row.innerHTML = `<span style="color:var(--text-secondary);min-width:60px;">${f.label}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.value.slice(0, 80)}</span>`;
      catDiv.appendChild(row);
    });
    list.appendChild(catDiv);
  });
}

async function applyAiResult(asNew) {
  if (!aiParsedData) return;

  const newCategories = aiParsedData.categories.map(cat => ({
    id: cat.id || 'cat_' + Math.random().toString(36).slice(2, 8),
    name: cat.name || '未命名',
    icon: cat.icon || '📌',
    fields: (cat.fields || []).map(f => ({
      label: f.label || '字段',
      value: f.value || ''
    }))
  }));

  if (asNew) {
    const name = aiParsedData.name || profile.name + ' (AI)';
    const { createEmptyProfile } = await import('../lib/constants.js');
    const newProfile = createEmptyProfile(name);
    newProfile.categories = newCategories;
    newProfile.updatedAt = Date.now();
    profiles.push(newProfile);
    await saveProfiles(profiles);
    await setActiveProfileId(newProfile.id);
    refreshProfileSelect();
    profile = newProfile;
    showToast(`✓ 已创建「${name}」`, 'success');
  } else {
    if (!confirm('将用 AI 解析结果覆盖「' + profile.name + '」？')) return;
    profile.categories = newCategories;
    profile.updatedAt = Date.now();
    await saveData();
    showToast('✓ 简历已更新', 'success');
  }
  render();
  closeAiModal();
}

// ============ External AI Link (Path B) ============

function refreshAiPrompt() {
  const area = el('rfAiPromptArea');
  const textEl = el('rfAiPromptText');
  if (!area || !textEl) return;

  const schemaJson = buildResumeSchema();
  textEl.textContent = `我已经上传了我的简历文件。请把简历中的内容原封不动填入以下 JSON 结构：

\`\`\`json
${JSON.stringify(schemaJson, null, 2)}
\`\`\`

铁律：
1. 一字不改——简历写什么就填什么，不要润色、不要总结、不要删减、不要改写
2. 严格按 JSON 结构填写，不要增删字段
3. 按编号顺序填入（学校1/学校2、公司1/公司2…），多段经历用不同编号
4. 描述字段把原文整段搬进去，不要提炼
5. 简历中没有对应信息的字段留空字符串 ""
6. 只输出 JSON，放在 \`\`\`json \`\`\` 代码块中`;
}

async function copyAiPrompt() {
  const text = el('rfAiPromptText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    showMsgBox('rfAiLinkMsg', '提示词已复制！粘贴给 AI，把返回的 JSON 贴回来', 'success');
  } catch {
    showMsgBox('rfAiLinkMsg', '请手动 Ctrl+C 复制', 'info');
  }
}

async function applyExternalJson(asNew) {
  const input = el('rfAiJsonInput');
  const raw = input ? input.value.trim() : '';
  if (!raw) { showMsgBox('rfAiLinkMsg', '请先粘贴 AI 返回的 JSON', 'error'); return; }

  let jsonStr = raw;
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) jsonStr = m[1].trim();

  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    showMsgBox('rfAiLinkMsg', 'JSON 格式错误: ' + e.message, 'error');
    return;
  }

  if (!data.categories) { showMsgBox('rfAiLinkMsg', '缺少 categories 数组', 'error'); return; }

  const newCategories = data.categories.map(cat => ({
    id: cat.id || 'cat_' + Math.random().toString(36).slice(2, 8),
    name: cat.name || '未命名',
    icon: cat.icon || '📌',
    fields: (cat.fields || []).map(f => ({ label: f.label || '字段', value: f.value || '' }))
  }));

  if (asNew) {
    const name = data.name || profile.name + ' (外部)';
    const { createEmptyProfile } = await import('../lib/constants.js');
    const newProfile = createEmptyProfile(name);
    newProfile.categories = newCategories;
    newProfile.updatedAt = Date.now();
    profiles.push(newProfile);
    await saveProfiles(profiles);
    await setActiveProfileId(newProfile.id);
    refreshProfileSelect();
    profile = newProfile;
    showMsgBox('rfAiLinkMsg', `✓ 已创建「${name}」`, 'success');
  } else {
    if (!confirm('将覆盖「' + profile.name + '」？')) return;
    profile.categories = newCategories;
    profile.updatedAt = Date.now();
    await saveData();
    showMsgBox('rfAiLinkMsg', '✓ 简历已更新', 'success');
  }
  render();
  closeAiModal();
}

function showMsgBox(containerId, msg, kind) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'msg ' + (kind || 'info');
}

// ============ Batch Scan & Fill (BETA — 需要 AI API Key) ============

async function doBatchScan() {
  if (!activeTabId) { showToast('无法获取当前页面', 'error'); return; }

  const aiConfig = await getAiConfig();
  if (!isAiEnabled(aiConfig)) { showToast('需要配置 AI API Key（设置页 → AI 配置）', 'error'); return; }

  try {
    const resp = await chrome.tabs.sendMessage(activeTabId, { type: 'SCAN_FORM' });
    if (!resp || !resp.elements || resp.elements.length === 0) { showToast('当前页面无可填充的表单', 'error'); return; }

    const allFields = [];
    profile.categories.forEach(cat => cat.fields.forEach(f => { if (f.value && f.value.trim()) allFields.push(f); }));
    if (allFields.length === 0) { showToast('简历数据为空，请先编辑或 AI 填简历', 'info'); return; }

    showToast('⏳ AI 正在匹配字段...', 'info');
    const matches = await matchFieldsWithAI(allFields, resp.elements);
    if (matches.length === 0) { showToast('AI 未匹配到可填充的字段（Beta 功能，准确率不保证）', 'info'); return; }

    const panel = el('rfBatchPanel'), list = el('rfBatchList'), title = el('rfBatchTitle');
    if (!panel || !list) return;
    panel.classList.remove('hidden');
    title.textContent = `匹配到 ${matches.length} 个字段 (Beta · 请核对)`;
    list.innerHTML = '';
    matches.forEach(m => {
      const row = document.createElement('div');
      row.className = 'rf-batch-item' + (m.confidence === 'low' ? ' low-confidence' : '');
      const emoji = m.confidence === 'high' ? '✅' : m.confidence === 'medium' ? '👍' : '⚠️';
      row.innerHTML = '<span class="rf-batch-confidence">' + emoji + '</span><div class="rf-batch-detail"><div class="rf-batch-field">' + m.field.label + ' → ' + (m.element.labelText || m.element.placeholder || m.element.name || '(未知)') + '</div><div class="rf-batch-value">' + m.field.value.slice(0, 50) + '</div></div>';
      list.appendChild(row);
    });
    panel._matches = matches;
    panel.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { showToast('扫描失败：' + err.message, 'error'); }
}

async function batchFill(highOnly) {
  const panel = el('rfBatchPanel');
  if (!panel || !panel._matches) return;
  let matches = panel._matches;
  if (highOnly) matches = matches.filter(m => m.confidence === 'high');

  const items = matches.map(m => ({ _idx: m.element._idx, id: m.element.id, name: m.element.name, placeholder: m.element.placeholder, value: m.field.value }));
  try {
    const resp = await chrome.tabs.sendMessage(activeTabId, { type: 'BATCH_FILL', items });
    if (resp && resp.results) {
      const ok = resp.results.filter(r => r.success).length, fail = resp.results.filter(r => !r.success).length;
      showToast('✅ 已填入 ' + ok + ' 项' + (fail > 0 ? '，' + fail + ' 项失败' : ''), fail > 0 ? 'info' : 'success');
    }
  } catch (err) { showToast('批量填充失败：' + err.message, 'error'); }
  panel.classList.add('hidden');
  panel._matches = null;
}

