// content.js — 表单填充（兼容 React/Vue 受控组件）
// 点击侧边栏按钮 → 扫描页面匹配最佳输入框 → 填入
(function () {
  'use strict';

  var scannedElements = [];  // DOM element cache for BATCH_FILL

  function isFillable(el) {
    if (!el) return false;
    var t = el.tagName.toLowerCase();
    if (t === 'input' || t === 'textarea' || t === 'select') return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  // ---- 消息处理 ----
  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.type === 'FILL') {
      // request: { label: "姓名", value: "张三" }
      // Scan all visible inputs, find best match by label keywords, fill it
      var el = findBestInput(request.label);
      if (el) { sendResponse(fillOne(el, request.value)); return true; }
      sendResponse({ success: false, error: '未找到匹配的输入框' });
      return true;
    }

    if (request.type === 'SCAN_FORM') {
      scannedElements = [];
      var elements = [], seen = {};
      document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]').forEach(function(el) {
        var rect = el.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 10) return;
        var k = el.id || el.name || el.placeholder || '';
        if (k && seen[k]) return;
        if (k) seen[k] = 1;
        var t = el.tagName.toLowerCase(), lt = '';
        if (el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) lt = lb.textContent.trim().slice(0, 50); }
        if (!lt) { var pl = el.closest('label'); if (pl) lt = pl.textContent.trim().slice(0, 50); }
        scannedElements.push(el);
        elements.push({ tag: t, type: el.type || '', id: el.id || '', name: el.name || '', placeholder: (el.placeholder || '').slice(0, 60), labelText: lt, _idx: scannedElements.length - 1 });
      });
      sendResponse({ elements: elements });
      return true;
    }

    if (request.type === 'BATCH_FILL') {
      var results = [];
      for (var i = 0; i < request.items.length; i++) {
        var item = request.items[i], el = null;
        if (item._idx !== undefined && item._idx >= 0 && item._idx < scannedElements.length) el = scannedElements[item._idx];
        if (!el && item.id) { el = document.getElementById(item.id); if (!el && item.name) el = document.querySelector('[name="' + item.name + '"]'); }
        if (!el && item.name) el = document.querySelector('[name="' + item.name + '"]');
        if (!el && item.placeholder) el = document.querySelector('[placeholder*="' + item.placeholder.slice(0, 15) + '"]');
        if (!el || !isFillable(el)) { results.push({ success: false, error: '未找到元素' }); continue; }
        try { results.push(fillOne(el, item.value)); } catch(e) { results.push({ success: false, error: e.message }); }
      }
      sendResponse({ results: results });
      return true;
    }
  });

  // ---- 扫描页面找最佳匹配 ----
  var KEYWORDS = {
    '姓名': ['姓名','名字','name','full name','username'],
    '手机': ['手机','电话','mobile','phone','tel','cell','contact','联系方式'],
    '邮箱': ['邮箱','email','e-mail','mail','电子邮件'],
    '城市': ['城市','city','location','所在城市','现居'],
    '学校': ['学校','毕业院校','school','university','college','院校'],
    '学位': ['学位','学历','degree','education'],
    '专业': ['专业','major','field of study'],
    '公司': ['公司','company','employer','workplace','工作单位'],
    '岗位': ['岗位','职位','position','title','role','job title'],
    '描述': ['描述','description','summary','experience','自我介绍','个人优势','about','bio'],
    '时间': ['时间','date','period','duration','起止'],
    'GPA': ['gpa','绩点','平均分','grade'],
    '荣誉': ['荣誉','奖项','honor','award','奖学金'],
    '课程': ['课程','course','主修课程'],
    '链接': ['链接','link','url','website','linkedin','github','个人主页'],
    '项目': ['项目','project'],
    '角色': ['角色','role','position'],
    '活动': ['活动','学位','organization','club'],
    '意向': ['意向','求职','期望','desired','target'],
  };

  function matchScore(label, keywords) {
    var lower = label.toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
    var best = 0;
    for (var i = 0; i < keywords.length; i++) {
      var kw = keywords[i].toLowerCase();
      if (lower === kw) return 10;
      if (lower.indexOf(kw) >= 0 || kw.indexOf(lower) >= 0) { if (7 > best) best = 7; }
      var toks = lower.split(/\s+/), kws = kw.split(/\s+/);
      var overlap = 0;
      for (var j = 0; j < toks.length; j++) { if (kws.indexOf(toks[j]) >= 0) overlap++; }
      if (overlap > 0 && 4 + overlap > best) best = 4 + overlap;
    }
    return best;
  }

  function getBaseLabel(fieldLabel) {
    return fieldLabel.replace(/\d+$/g, '');
  }

  function findBestInput(fieldLabel) {
    var baseLabel = getBaseLabel(fieldLabel);
    var kws = KEYWORDS[baseLabel];
    if (!kws) {
      // No keyword mapping — try literal match or fallback to all inputs
      kws = [baseLabel];
    }

    var bestEl = null, bestScore = 0;
    var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select, [contenteditable="true"]');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var rect = el.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 10) continue;
      var searchText = [];
      if (el.id) searchText.push(el.id);
      if (el.name) searchText.push(el.name);
      if (el.placeholder) searchText.push(el.placeholder.slice(0, 60));
      // Try to get label text
      var lt = '';
      if (el.id) { var lb = document.querySelector('label[for="' + el.id + '"]'); if (lb) lt = lb.textContent.trim().slice(0, 50); }
      if (!lt) { var pl = el.closest('label'); if (pl) lt = pl.textContent.trim().slice(0, 50); }
      searchText.push(lt);
      var text = searchText.join(' ').toLowerCase();
      var score = matchScore(text, kws);
      if (score > bestScore) { bestScore = score; bestEl = el; }
    }
    return bestEl;
  }

  // ---- 填充逻辑 ----
  function fillOne(el, value) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'select') return fillSelect(el, value);
    if (tag === 'input' || tag === 'textarea') return fillInput(el, value);
    if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return fillContentEditable(el, value);
    return { success: false, error: '不支持的输入类型: ' + tag };
  }

  function fillInput(el, value) {
    el.focus();
    var proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (nativeSetter && nativeSetter.set) nativeSetter.set.call(el, value);
    else el.value = value;
    if (el._valueTracker) el._valueTracker.setValue(el.value);
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return { success: true, filled: value };
  }

  function fillSelect(el, value) {
    el.focus();
    var search = value.toLowerCase().trim(), bestIdx = -1;
    for (var i = 0; i < el.options.length; i++) {
      var opt = el.options[i];
      if (!opt || opt.disabled) continue;
      var text = (opt.text || opt.label || '').toLowerCase().trim();
      var val = (opt.value || '').toLowerCase().trim();
      if (text === search || val === search) { bestIdx = i; break; }
      if (bestIdx === -1 && (text.includes(search) || search.includes(text))) bestIdx = i;
    }
    if (bestIdx >= 0) {
      el.selectedIndex = bestIdx;
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      return { success: true, filled: el.options[bestIdx].text };
    }
    return { success: false, error: '未找到匹配选项: ' + value };
  }

  function fillContentEditable(el, value) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return { success: true, filled: value };
  }
})();
