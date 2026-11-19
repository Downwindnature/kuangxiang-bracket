// util.js — 共用小工具
export const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function uid(prefix = '') {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return prefix + a[0].toString(36) + a[1].toString(36).slice(0, 4);
}

export const nfkc = (s) => String(s == null ? '' : s).normalize('NFKC');

export function pad2(n) { return String(n).padStart(2, '0'); }

export function fmtDateTime(v) {
  if (!v) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function parseJSON(s, fallback = null) {
  if (s == null || s === '') return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

// 樣板文字：{A} {B} {W} {R} {T} {N} 會換成名稱，VS 會加上特效
export function renderTpl(tpl, vars = {}) {
  const parts = String(tpl || '').split(/(\{[A-Z]\}|VS)/g);
  return parts.map((p) => {
    if (!p) return '';
    const m = /^\{([A-Z])\}$/.exec(p);
    if (m) {
      const v = vars[m[1]];
      if (v == null) return '';
      const cls = m[1] === 'A' ? 'tA' : m[1] === 'B' ? 'tB' : m[1] === 'W' ? 'tW' : 'tX';
      return `<span class="tk ${cls}">${esc(v)}</span>`;
    }
    if (p === 'VS') return '<span class="tk-vs">VS</span>';
    return `<span class="tk-txt">${esc(p)}</span>`;
  }).join('');
}

// 依文字寬度縮小字級，避免超出框框
export function fitText(el, { min = 0.45 } = {}) {
  if (!el) return;
  el.style.fontSize = '';
  const base = parseFloat(getComputedStyle(el).fontSize) || 16;
  let size = base;
  let guard = 0;
  while (el.scrollWidth > el.clientWidth + 1 && size > base * min && guard++ < 30) {
    size *= 0.93;
    el.style.fontSize = size + 'px';
  }
}

let measureCtx = null;
export function textWidth(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export const FONT_STACK = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Heiti TC", "Microsoft YaHei", sans-serif';
