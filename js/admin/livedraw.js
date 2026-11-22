// admin/livedraw.js — 直播抽籤的共用動作（「選手抽籤 ③」與全螢幕抽籤球畫面共用）
import { S, saveDraw, saveSettings, snapshot, emit, teamNames } from './state.js';
import { revealSteps, revealPending, teamCount, hasResults, clearAllResults } from '../bracket.js';
import { withDefaults, drawTiming, DRAW_FX } from '../banner.js';
import { toast, confirmDlg } from './ui.js';

const FX_KEY = 'kxb-drawfx';
export const numIn = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function fxPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(FX_KEY)) || {}; } catch (e) { p = {}; }
  return { fx: p.fx !== false, tumble: numIn(p.tumble, 1, 10, DRAW_FX.tumble), hold: numIn(p.hold, 0.5, 15, DRAW_FX.hold), gap: numIn(p.gap, 0, 30, 1.5) };
}

export function saveFxPrefs(patch) {
  try { localStorage.setItem(FX_KEY, JSON.stringify(Object.assign(fxPrefs(), patch))); } catch (e) { /* 無痕模式存不了就算了 */ }
}

// 前台的抽籤動畫還要播多久（毫秒，以伺服器時間計算，重新整理後台也算得出來）
export function busyLeftMs() {
  const b = S.banner;
  const d = b && b.mode === 'draw' ? b.draw : null;
  if (!d || !d.at || d.kind !== 'pair' || !d.fx) return 0;
  return Math.max(0, d.at + drawTiming(d).end * 1000 - S.store.now());
}

export function stepLabel(steps, i) {
  const s = steps && steps[i];
  if (!s) return '';
  if (s.pair) return `🎰 抽出第 ${steps.slice(0, i + 1).filter((x) => x.pair).length} 組`;
  return s.l.length > 1 ? `揭曉剩下的 ${s.l.length} 隊` : '揭曉最後一隊';
}

// 目前直播抽籤的進度
export function liveInfo() {
  const br = S.bracket;
  const rev = br && br.reveal;
  const steps = rev && Array.isArray(rev.steps) ? rev.steps : null;
  const shown = (rev && rev.shown) || 0;
  const plan = br ? revealSteps(br) : [];
  const list = steps || plan;
  return {
    br,
    steps,
    shown,
    revealing: revealPending(rev),
    legacy: !!(rev && !steps && revealPending(rev)),
    pairsTotal: list.filter((x) => x.pair).length,
    pairsShown: steps ? steps.slice(0, shown).filter((x) => x.pair).length : (br && br.published && !rev ? list.filter((x) => x.pair).length : 0),
    next: steps && shown < steps.length ? steps[shown] : null,
    label: steps ? stepLabel(steps, shown) : '',
    plan,
    pool: steps ? steps.slice(shown).reduce((a, x) => a + x.l.length, 0) : 0,
  };
}

// 已經抽出的組（最新的在前面）；沒有在直播抽籤、但已公布時就是全部
export function drawnList() {
  const br = S.bracket;
  if (!br) return [];
  const rev = br.reveal;
  let steps;
  if (rev && Array.isArray(rev.steps)) steps = rev.steps.slice(0, rev.shown || 0);
  else if (!rev && br.published) steps = revealSteps(br);
  else steps = [];
  const names = teamNames();
  let n = 0;
  return steps.map((st) => ({
    n: st.pair ? ++n : 0,
    pair: st.pair,
    leaves: st.l.slice(),
    names: st.l.map((l) => names[br.leaves[l]] || '未命名隊伍'),
  })).reverse();
}

let listener = null;
export function bindView(fn) { listener = fn; }
function notify() {
  emit('bracket');
  if (listener) { try { listener(); } catch (e) { console.error(e); } }
}

// ── 自動抽籤 ──
let autoTimer = null;
let autoOn = false;
export const isAuto = () => autoOn;
export function stopAuto() { clearTimeout(autoTimer); autoTimer = null; autoOn = false; }
function scheduleAuto() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => { if (autoOn) drawNext(); }, busyLeftMs() + fxPrefs().gap * 1000);
}
export function toggleAuto() {
  if (autoOn) { stopAuto(); notify(); return false; }
  autoOn = true;
  if (busyLeftMs() > 0) { scheduleAuto(); notify(); } else drawNext();
  return true;
}

// ── 抽出下一組（或最後剩下的隊伍）──
let stepping = false; // 正在寫入這一步（避免連點跳過一組）
export async function drawNext() {
  const r = S.bracket && S.bracket.reveal;
  if (!r || !Array.isArray(r.steps) || (r.shown || 0) >= r.steps.length) return false;
  if (stepping || busyLeftMs() > 0) return false;
  stepping = true;
  const pr = fxPrefs();
  const i = r.shown || 0;
  const st = r.steps[i];
  const last = i + 1 >= r.steps.length;
  const names = teamNames();
  const at = S.store.now();
  const draw = {
    kind: st.pair ? 'pair' : 'solo',
    n: r.steps.slice(0, i + 1).filter((x) => x.pair).length,
    pairs: r.steps.filter((x) => x.pair).length,
    total: teamCount(S.bracket),
    leaves: st.l.slice(),
    names: st.l.map((l) => names[S.bracket.leaves[l]] || '未命名隊伍'),
    fx: !!(st.pair && pr.fx),
    tumble: pr.tumble,
    hold: pr.hold,
    pool: r.steps.slice(i).reduce((a, x) => a + x.l.length, 0),
    last,
    at,
  };
  S.bracket = Object.assign({}, S.bracket, { reveal: last ? null : { steps: r.steps, shown: i + 1 } });
  S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'draw', at, draw }));
  try { await saveDraw(); } finally { stepping = false; }
  if (last) { stopAuto(); toast('全部抽完了！'); } else if (autoOn) scheduleAuto();
  notify();
  return true;
}

// ── 開始（或從頭重新開始）直播抽籤 ──
export async function startLiveDraw() {
  const br = S.bracket;
  if (!br) { toast('請先在「選手抽籤 ②」抽籤', { type: 'warn' }); return false; }
  const info = liveInfo();
  const results = hasResults(br);
  let msg = '';
  if (info.revealing) msg = '從頭重新開始直播抽籤？已經抽出的組會先變回「？」。';
  else if (br.published) msg = '重新開始直播抽籤？前台會先把所有隊伍變成「？」。';
  if (results) msg = `${msg || '開始直播抽籤？'}\n已經登錄的比賽結果（勝方、比分）會一起清除，清除前會自動備份。`;
  if (msg && !(await confirmDlg(msg, { ok: info.revealing ? '從頭開始' : '開始', danger: results }))) return false;
  stopAuto();
  if (results) await snapshot('直播抽籤前');
  const fresh = results ? clearAllResults(br) : br;
  const at = S.store.now();
  S.bracket = Object.assign({}, fresh, { published: true, reveal: { steps: revealSteps(fresh), shown: 0 } });
  S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'draw', at, cur: null, draw: { kind: 'start', total: teamCount(fresh), at } }));
  if (S.settings.stage === 'blank' || S.settings.stage === 'teams') {
    S.settings.stage = 'auto';
    await saveSettings();
  }
  await saveDraw();
  notify();
  toast('直播抽籤開始：前台目前全部是「？」');
  return true;
}

// ── 直接揭曉剩下的全部隊伍（不播動畫）──
export async function revealAllNow({ ask = true } = {}) {
  if (!S.bracket) return false;
  if (ask && !(await confirmDlg('直接揭曉剩下的所有隊伍？（不播抽籤動畫）', { ok: '全部揭曉' }))) return false;
  stopAuto();
  S.bracket = Object.assign({}, S.bracket, { reveal: null });
  S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'draw', at: S.store.now(), draw: { done: true, total: teamCount(S.bracket) } }));
  await saveDraw();
  notify();
  toast('已全部揭曉');
  return true;
}
