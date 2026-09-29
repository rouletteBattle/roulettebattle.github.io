/* 共通UI: 確認ダイアログ・お知らせ・トースト (claude.ai 上では confirm/alert が使えないため自前で用意) */
var RBUI = (function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let queue = Promise.resolve();

  function layer() {
    let el = document.getElementById('rbDialog');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rbDialog';
      el.className = 'modal-bg dialog-bg';
      el.hidden = true;
      document.body.appendChild(el);
    }
    return el;
  }

  // buttons: [{ label, value, cls }]
  function dialog(message, buttons, opts) {
    opts = opts || {};
    const run = () => new Promise((resolve) => {
      const el = layer();
      el.innerHTML = `<div class="panel modal dialog" role="dialog" aria-modal="true">
        ${opts.title ? `<h3>${esc(opts.title)}</h3>` : ''}
        <div class="dialog-msg">${esc(message).replace(/\n/g, '<br>')}</div>
        <div class="dialog-btns">${buttons.map((b, i) => `<button type="button" data-i="${i}" class="${b.cls || ''}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      el.hidden = false;
      const done = (v) => { el.hidden = true; el.innerHTML = ''; document.removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(opts.cancelValue); }
      };
      document.addEventListener('keydown', onKey, true);
      el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => done(buttons[+b.dataset.i].value); });
      el.onclick = (e) => { if (e.target === el) done(opts.cancelValue); };
      const def = el.querySelector('.primary, .danger') || el.querySelector('button');
      if (def) def.focus();
    });
    const p = queue.then(run);
    queue = p.catch(() => {});
    return p;
  }

  function confirm(message, opts) {
    opts = opts || {};
    return dialog(message, [
      { label: opts.cancel || 'キャンセル', value: false },
      { label: opts.ok || 'OK', value: true, cls: opts.danger ? 'danger' : 'primary' },
    ], { title: opts.title, cancelValue: false });
  }

  function alert(message, opts) {
    opts = opts || {};
    return dialog(message, [{ label: 'OK', value: true, cls: 'primary' }], { title: opts.title, cancelValue: true });
  }

  function toast(msg, ms) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2000);
  }

  // クリップボードにコピー (失敗したら要素を選択状態にする)
  async function copyText(text, fallbackEl) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      if (fallbackEl) {
        fallbackEl.focus();
        if (fallbackEl.select) fallbackEl.select();
        try { if (document.execCommand('copy')) return true; } catch (e2) { /* noop */ }
      }
      return false;
    }
  }

  return { dialog, confirm, alert, toast, copyText, esc };
})();
