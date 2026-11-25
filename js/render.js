// render.js — 把賽程畫成 DOM（前台顯示屏與後台預覽共用）
import { analyze, THIRD } from './bracket.js?v=f641a603';
import { layoutBracket } from './layout.js?v=f641a603';
import { esc, textWidth, FONT_STACK } from './util.js?v=f641a603';

const NAME_FONT_PX = 18;
const SCORE_W = 38;

function fitName(name, avail) {
  const w = textWidth(name, `700 ${NAME_FONT_PX}px ${FONT_STACK}`);
  if (w <= avail) return '';
  const size = Math.max(11, Math.floor(NAME_FONT_PX * (avail / w) * 10) / 10);
  return `font-size:${size}px;`;
}

// pub：前台版本的賽程（publicView 的結果）
// opts：{ settings, liveId, interactive, selectedLeaf, prev, fit:{w,h}, maxScale }
export function renderBracket(el, pub, opts = {}) {
  const st = opts.settings || {};
  const showTimes = st.showTimes !== false;
  const showScores = st.showScores !== false;
  const showZero = st.showZero !== false;
  const A = analyze(pub);
  let L = layoutBracket(A);
  if (opts.fit && L.H > 0) {
    // 寬度先滿時，把上下間距拉開，讓賽程表用滿版面高度（跟設計稿一樣有呼吸感）
    const sW = opts.fit.w / L.W;
    if (opts.fit.h / L.H > sW) {
      const base = L.P.pitch;
      const L2 = layoutBracket(A, { pitch: base * 2 });
      const per = (L2.H - L.H) / base; // 每多 1 單位 pitch，H 增加多少
      if (per > 0) {
        const target = opts.fit.h / Math.min(sW, opts.maxScale || 1.6);
        const pitch = Math.min(base * 1.9, base + Math.max(0, (target - L.H) / per));
        L = layoutBracket(A, { pitch });
      }
    }
  }
  const { P, boxH } = L;
  const names = pub.names || {};
  const prev = opts.prev || {};
  const nextPrev = { leaves: pub.leaves.slice(), wins: {} };
  const avail = P.boxW - SCORE_W - 18;

  const slot = (n, i, kind) => {
    const v = n.ent[i];
    const leaf = n.src ? n.src[i] : null;
    let cls = 'mb-row', name = '', score = '', style = '', extra = '';
    if (v === null) { cls += ' byeslot'; name = '輪空'; }
    else if (v === undefined) { cls += ' tbd'; score = showZero ? '0' : ''; }
    else if (v === '?') { cls += ' unrev'; name = '？'; }
    else {
      name = names[v] || '未命名隊伍';
      style = fitName(name, avail - (kind === 'final' && n.done && n.w === i ? 22 : 0));
      if (n.done) cls += n.w === i ? ' win' : ' lose';
      const s = n.score ? n.score[i] : '';
      score = s !== '' && s != null ? String(s) : (showZero ? '0' : '');
      if (leaf != null && prev.leaves && prev.leaves[leaf] === '?') cls += ' flash';
      if (n.done && n.w === i && prev.wins && prev.wins[n.id] !== n.winner) cls += ' flash-win';
    }
    if (leaf != null && v !== undefined && v !== null) {
      extra = ` data-leaf="${leaf}"`;
      if (opts.interactive) {
        cls += ' pick';
        if (opts.selectedLeaf === leaf) cls += ' picked';
      }
    }
    if (!showScores) score = '';
    const crown = kind === 'final' && n.done && n.w === i ? '<span class="mb-crown">👑</span>' : '';
    return `<div class="${cls}"${extra}><span class="mb-name" style="${style}">${crown}${esc(name)}</span>${n.type === 'match' || kind === 'final' || kind === 'third' ? `<span class="mb-score">${esc(score)}</span>` : '<span class="mb-score"></span>'}</div>`;
  };

  let html = '';
  // 連接線
  html += `<svg class="bk-lines" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" aria-hidden="true">`;
  for (const l of L.lines) {
    const d = 'M' + l.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
    html += `<path class="ln ${l.state}" d="${d}"/>`;
  }
  html += '</svg>';

  for (const t of L.titles) {
    const n = t.kind === 'final' ? A.nodes[1] : A.third;
    let time = n && n.time && showTimes ? `<div class="bk-ttime">${esc(n.time)}</div>` : '';
    if (t.kind === 'final' && A.champion && st.showChampion !== false) time = `<div class="bk-ttime champ">冠軍　${esc(names[A.champion] || '')}</div>`;
    html += `<div class="bk-title ${t.kind}" style="left:${t.x - 200}px;top:${t.top - P.timeH}px;width:400px;height:${t.h + P.timeH}px">${time}<div class="bk-ttext">${esc(t.text)}</div></div>`;
  }

  for (const b of L.boxes) {
    const n = b.kind === 'final' ? A.nodes[1] : b.kind === 'third' ? A.third : A.nodes[b.p];
    if (!n) continue;
    if (n.done) nextPrev.wins[n.id] = n.winner;
    const cls = ['mb', `side-${b.side}`, `k-${b.kind}`];
    if (n.type === 'bye') cls.push('is-bye');
    if (n.done) cls.push('done');
    if (!n.done && opts.liveId != null && String(opts.liveId) === String(n.id)) cls.push('live'); // 打完的場次不再標成比賽中
    if (opts.interactive && n.type === 'match') cls.push('clickable');
    const time = showTimes && n.time && b.kind !== 'final' && b.kind !== 'third' ? `<div class="mb-time">${esc(n.time)}</div>` : '';
    html += `<div class="${cls.join(' ')}" data-node="${esc(n.id)}" style="left:${b.x}px;top:${b.y - boxH / 2}px;width:${P.boxW}px;height:${boxH}px">${time}${slot(n, 0, b.kind)}${slot(n, 1, b.kind)}</div>`;
  }

  const wrap = document.createElement('div');
  wrap.className = 'bk';
  wrap.style.width = L.W + 'px';
  wrap.style.height = L.H + 'px';
  wrap.innerHTML = html;

  let scale = 1;
  if (opts.fit) {
    scale = Math.min(opts.fit.w / L.W, opts.fit.h / L.H, opts.maxScale || 1.6);
    wrap.style.transform = `scale(${scale})`;
    wrap.style.left = Math.max(0, (opts.fit.w - L.W * scale) / 2) + 'px';
    wrap.style.top = Math.max(0, (opts.fit.h - L.H * scale) / 2) + 'px';
  }
  el.replaceChildren(wrap);
  return { A, L, scale, prev: nextPrev };
}

export { THIRD };
