// admin/ui.js — 對話框、提示訊息
import { esc } from '../util.js?v=2628f905';

export function toast(msg, { type = 'ok', ms = 3600, action = null } = {}) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.appendChild(b);
  }
  root.appendChild(el);
  while (root.children.length > 3) root.firstChild.remove(); // 最多同時顯示 3 則，舊的先收掉
  setTimeout(() => el.classList.add('out'), ms);
  setTimeout(() => el.remove(), ms + 400);
  return el;
}

// buttons: [{ label, cls, onClick(close, dlgEl) → 回傳 false 就不關閉 }]
export function modal({ title = '', body = '', wide = false, buttons = [{ label: '關閉' }], onOpen = null, onClose = null } = {}) {
  const root = document.getElementById('modals');
  const mask = document.createElement('div');
  mask.className = 'mask';
  mask.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div class="dlg-body"></div><div class="foot"></div></div>`;
  const dlg = mask.firstChild;
  const bodyEl = dlg.querySelector('.dlg-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    mask.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const foot = dlg.querySelector('.foot');
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.cls) btn.className = b.cls;
    btn.onclick = async () => {
      if (b.onClick) {
        btn.disabled = true;
        try {
          const r = await b.onClick(close, dlg);
          if (r === false) { btn.disabled = false; return; }
        } catch (e) {
          console.error(e);
          toast((e && e.message) || String(e), { type: 'err' });
          btn.disabled = false;
          return;
        }
      }
      close();
    };
    foot.appendChild(btn);
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  root.appendChild(mask);
  onOpen && onOpen(dlg, close);
  const first = dlg.querySelector('input, select, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { el: dlg, close };
}

export function confirmDlg(message, { title = '請確認', ok = '確定', cancel = '取消', danger = false, html = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: html ? message : `<p class="pre">${esc(message)}</p>`,
      buttons: [
        { label: cancel, cls: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: ok, cls: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function busy(btn, on, text) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; if (text) btn.textContent = text; }
  else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
}

// 每頁的標題列：標題＋「？ 這頁怎麼用」（只看這一頁的使用教學）
export function pageHead(title, chapter) {
  return `<div class="page-head"><h2 class="page-title">${esc(title)}</h2>${chapter ? `<button type="button" class="help-chip" data-tour="${esc(chapter)}" title="只看這一頁的使用教學">？ 這頁怎麼用</button>` : ''}</div>`;
}
