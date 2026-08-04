// content.js — 表单填充（兼容 React/Vue 受控组件）
// 点击侧边栏按钮 → 填入当前聚焦的输入框 → 没聚焦则填第一个可见输入框
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
      // 1. 当前聚焦的输入框
      var el = document.activeElement;
      if (!el || !isFillable(el)) {
        // 2. 没聚焦 → 找第一个可见输入框
        var inputs = document.querySelectorAll('input:not([type="hidden"]), textarea, select, [contenteditable="true"]');
        for (var i = 0; i < inputs.length; i++) {
          var r = inputs[i].getBoundingClientRect();
          if (r.width >= 20 && r.height >= 10 && isFillable(inputs[i])) {
            el = inputs[i];
            break;
          }
        }
      }
      if (!el) { sendResponse({ success: false, error: '未找到可填充的输入框' }); return true; }
      sendResponse(fillOne(el, request.value));
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
