// display.js — 前台顯示屏
import { openStore } from './store.js?v=6c54854c';
import { renderBracket } from './render.js?v=6c54854c';
import { withDefaults, drawTiming } from './banner.js?v=6c54854c';
import { createBannerUI } from './bannerui.js?v=6c54854c';
import { parseJSON, esc } from './util.js?v=6c54854c';
import { createBracket, setResult, analyze, nextMatch, publicView, autoTimes, revealSteps, MODE_ODD, MODE_POW2, THIRD } from './bracket.js?v=6c54854c';
import { startStars } from './bg.js?v=6c54854c';
import { createDrawFx, drawMask } from './drawfx.js?v=6c54854c';

const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const board = $('board');
const bannerEl = $('banner');
const BOARD_W = 1868, BOARD_H = 800;
const PAGE_TITLE = document.title;

if (q.has('obs')) document.body.classList.add('obs');
startStars($('stars'));

function fitStage() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener('resize', fitStage);
fitStage();

const S = { settings: {}, banner: null, bracket: null, teams: null };
let now = () => Date.now();
let prevRender = null;
let lastBoardKey = '';
let dataKey = '';
const bannerUI = createBannerUI(bannerEl, { now: () => now() });
const fx = createDrawFx(stage, { now: () => now(), board, onFrame: () => { renderBoard(); tickBanner(); } });

function liveIdOf() {
  const b = withDefaults(S.banner);
  return b.mode === 'flow' ? b.cur : null;
}

function renderBoard() {
  const st = S.settings || {};
  document.body.classList.toggle('no-motion', st.gridMotion === false);
  $('adminBtn').hidden = st.showAdminBtn === false;
  const mode = st.stage || 'auto';
  let what = 'blank';
  if (mode === 'auto' || mode === 'bracket') what = S.bracket ? 'bracket' : 'blank';
  else if (mode === 'teams') what = S.teams ? 'teams' : 'blank';
  const liveId = liveIdOf();
  const mask = what === 'bracket' ? drawMask(S.banner, now()) : null; // 抽籤動畫還沒播完的那一組先顯示「？」
  const key = JSON.stringify([what, dataKey, liveId, mask]);
  if (key === lastBoardKey) return;
  lastBoardKey = key;
  if (what === 'bracket') {
    let pub = S.bracket;
    if (mask) pub = Object.assign({}, pub, { leaves: pub.leaves.map((x, i) => (x && mask.includes(i) ? '?' : x)) });
    const r = renderBracket(board, pub, { settings: st, liveId, prev: prevRender, fit: { w: BOARD_W, h: BOARD_H }, maxScale: 1.35 });
    prevRender = r.prev;
  } else if (what === 'teams') {
    renderTeams(S.teams, st);
    prevRender = null;
  } else {
    board.replaceChildren();
    prevRender = null;
  }
}

function renderTeams(data, st) {
  const teams = (data && data.teams) || [];
  const waiting = (data && data.waiting) || [];
  const showMembers = st.listMembers !== false;
  const cols = teams.length <= 8 ? 4 : teams.length <= 15 ? 5 : teams.length <= 24 ? 6 : teams.length <= 40 ? 8 : 10;
  const cardW = Math.floor((BOARD_W - (cols - 1) * 16) / cols);
  const cards = teams.map((t) => {
    const mem = (t.m || []).map((x, i) => (i === t.c ? `<b>★${esc(x)}</b>` : esc(x))).join('、');
    return `<div class="tl-card"><div class="tl-name">${esc(t.n)}</div>${showMembers && mem ? `<div class="tl-mem">${mem}</div>` : ''}</div>`;
  }).join('');
  const wait = waiting.length ? `<div class="tl-sec">待媒合選手（${waiting.length} 人）</div><div>${waiting.map((x) => `<span class="tl-chip">${esc(x)}</span>`).join('')}</div>` : '';
  const wrap = document.createElement('div');
  wrap.className = 'tl';
  wrap.innerHTML = `<div class="tl-head">${esc(data.title || '參賽隊伍')}（${teams.length} 隊）</div><div class="tl-grid" style="grid-template-columns:repeat(${cols}, ${cardW}px)">${cards}</div>${wait}`;
  board.replaceChildren(wrap);
  const h = wrap.scrollHeight;
  if (h > BOARD_H) {
    const s = BOARD_H / h;
    wrap.style.transformOrigin = '50% 0';
    wrap.style.transform = `scale(${s})`;
  }
}

// 上方看板：一般樣式／跑馬燈樣式（bannerui.js）
function tickBanner() {
  bannerUI.update({ banner: S.banner, bracket: S.bracket, settings: S.settings });
}

function apply(v) {
  v = v || {};
  S.settings = parseJSON(v.settings, {}) || {};
  S.banner = parseJSON(v.banner, null);
  S.bracket = parseJSON(v.bracket, null);
  S.teams = parseJSON(v.teams, null);
  document.title = S.settings.title ? `${S.settings.title}｜賽程表` : PAGE_TITLE;
  refresh();
}

function refresh() {
  dataKey = JSON.stringify([S.bracket, S.teams, S.settings]);
  fx.sync(S.banner);
  renderBoard();
  tickBanner();
}

async function main() {
  if (q.has('demo')) { demo(); }
  else {
    try {
      const store = await openStore();
      now = store.now;
      store.watch('public', apply, (e) => showError(e));
      let offTimer = null;
      store.onConnection((c) => {
        clearTimeout(offTimer);
        if (c) $('offline').hidden = true;
        else offTimer = setTimeout(() => { $('offline').hidden = false; }, 4000);
      });
    } catch (e) {
      showError(e);
    }
  }
  setInterval(() => { fx.sync(S.banner); renderBoard(); tickBanner(); }, 250);
}

function showError(e) {
  console.error(e);
  const box = $('offline');
  box.textContent = '讀取資料失敗：' + ((e && e.message) || e);
  box.hidden = false;
}

// ── 示範模式：index.html?demo=18&mode=pow2&played=0.5&banner=vs ──
const DEMO_NAMES = ['社長', '鳳飄飄兩瀟瀟', '阿岱', 'DIO', '小楊', 'TakeItEZ', '來個會玩的輔助', '迷途小喵', 'johnny850124',
  '德原醬油店', 'WildHunt', 'Winglien', 'despairq741', '可愛小咪', '掠鴉庭公主', 'TwinsBlade', 'LMbooy005', '五河琴里'];

function seeded(s) {
  let x = (s * 2654435761) % 2147483647 || 7;
  return () => (x = (x * 48271) % 2147483647) / 2147483647;
}

function demo() {
  const n = Math.max(2, Math.min(128, Number(q.get('demo')) || 16));
  const mode = q.get('mode') === 'pow2' ? MODE_POW2 : MODE_ODD;
  const rng = seeded(n + (mode === MODE_POW2 ? 1000 : 0));
  const ids = Array.from({ length: n }, (_, i) => 'd' + i);
  const names = {};
  ids.forEach((id, i) => { names[id] = DEMO_NAMES[i] || `隊伍 ${String(i + 1).padStart(2, '0')}`; });
  let br = createBracket(ids, { mode, third: q.get('third') !== '0', rng });
  br = autoTimes(br, { start: q.get('start') || '21:00', every: 30 });
  const played = Math.max(0, Math.min(1, Number(q.get('played') || 0)));
  let A = analyze(br);
  const total = Object.values(A.nodes).filter((x) => x.type === 'match').length + (A.third ? 1 : 0);
  let done = 0;
  while (done < Math.round(total * played)) {
    A = analyze(br);
    const nx = nextMatch(A, null);
    if (!nx) break;
    const w = rng() < 0.5 ? 0 : 1;
    const lo = Math.floor(rng() * 15);
    br = setResult(br, nx.id, w, w === 0 ? [20, lo] : [lo, 20]);
    done++;
  }
  if (q.has('drawfx')) {
    S.settings = { title: '狂想之息 比賽', subtitle: '第五人格｜賽程表', stage: 'auto' };
    demoDraw(br, names, n);
    return;
  }
  let reveal = null;
  if (q.has('reveal')) {
    const order = br.leaves.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    reveal = { order, shown: Math.round(order.length * Number(q.get('reveal') || 0)) };
  }
  S.bracket = publicView(br, names, reveal);
  S.settings = { title: '狂想之息 比賽', subtitle: '第五人格｜賽程表', stage: q.get('stage') || 'auto' };
  A = analyze(S.bracket);
  const nx = nextMatch(A, null);
  const bm = q.get('banner') || (nx ? 'flow' : 'idle');
  const t0 = Date.now();
  if (bm === 'idle') S.banner = { mode: 'idle' };
  else if (bm === 'custom') S.banner = { mode: 'custom', custom: q.get('text') || '比賽即將開始\n請各隊長確認隊員到齊', at: t0 };
  else if (bm === 'draw') S.banner = { mode: 'draw', draw: { n: 5, total: n, team: ids[3] } };
  else if (bm === 'result') {
    const last = Object.values(A.nodes).filter((x) => x.done).sort((a, b) => b.round - a.round)[0];
    S.banner = { mode: 'result', cur: last ? last.id : null, at: t0 };
  } else {
    const cur = nx ? nx.id : null;
    const offset = bm === 'live' ? 7000 : bm === 'next' ? 22500 : 0;
    S.banner = { mode: 'flow', cur, next: 'auto', at: t0 - offset, dur: { vs: 6, live: 15, next: 6 } };
  }
  demoLook();
  if (q.get('stage') === 'teams') {
    S.teams = { title: '參賽隊伍', teams: ids.slice(0, Math.min(n, 30)).map((id, i) => ({ n: names[id], m: [names[id], `隊員${i}A`, `隊員${i}B`], c: 0 })), waiting: ['小明', '阿華', 'Kiki'] };
  }
  refresh();
}

// 看板樣式示範：&look=marquee（跑馬燈）、&speed=slow、&extra=現在時間：{日期} {星期} {時間}、&title=（留空）、&sub=
function demoLook() {
  if (q.get('look')) S.banner.look = q.get('look');
  if (q.has('extra')) S.banner.extra = q.get('extra');
  if (q.has('speed')) S.banner.speed = q.get('speed');
  if (q.has('title')) S.settings.title = q.get('title');
  if (q.has('sub')) S.settings.subtitle = q.get('sub');
}

// 抽籤動畫示範：index.html?demo=12&drawfx=1（自動一組一組抽）；&step=2&t=4.5 停在第 3 步的第 4.5 秒；&nofx=1 不播動畫
function demoDraw(br, names, n) {
  const steps = revealSteps(br);
  const pairs = steps.filter((s) => s.pair).length;
  const fxOn = q.get('nofx') !== '1';
  const tumble = Number(q.get('tumble')) || undefined;
  const hold = Number(q.get('hold')) || undefined;
  const show = (i, offsetMs = 0) => {
    const s = steps[i];
    const at = Date.now() - offsetMs;
    S.bracket = publicView(br, names, { steps, shown: i + 1 });
    S.banner = {
      mode: 'draw', at,
      draw: {
        kind: s.pair ? 'pair' : 'solo', n: steps.slice(0, i + 1).filter((x) => x.pair).length, pairs, total: n,
        leaves: s.l, names: s.l.map((l) => names[br.leaves[l]]), fx: fxOn && s.pair, tumble, hold,
        pool: steps.slice(i).reduce((a, x) => a + x.l.length, 0), last: i === steps.length - 1, at,
      },
    };
    demoLook();
    refresh();
  };
  if (q.has('t')) { show(Math.max(0, Math.min(steps.length - 1, Number(q.get('step')) || 0)), Number(q.get('t')) * 1000); return; }
  const startView = () => {
    S.bracket = publicView(br, names, { steps, shown: 0 });
    S.banner = { mode: 'draw', at: Date.now(), draw: { kind: 'start', total: n, at: Date.now() } };
    demoLook();
    refresh();
  };
  let i = -1;
  const next = () => {
    i++;
    if (i >= steps.length) { setTimeout(() => { i = -1; startView(); setTimeout(next, 2500); }, 8000); return; }
    show(i);
    const d = S.banner.draw;
    setTimeout(next, (d.fx ? drawTiming(d).end : 0) * 1000 + 1500);
  };
  startView();
  setTimeout(next, 2500);
}

main();
