// banner.js — 頂端固定顯示屏（通知看板）：VS → 正在比賽中 → 下一場請準備 …，所有時間與文字都可在後台設定
import { analyze, getNode, nextMatch, matchTitle } from './bracket.js?v=6c54854c';
import { esc, renderTpl } from './util.js?v=6c54854c';

export const BANNER_DEFAULTS = {
  mode: 'idle',        // idle 待機 / flow 對戰流程 / result 結果公告 / custom 自訂公告 / draw 抽籤
  at: 0,               // 開始時間（伺服器時間 ms）
  cur: null,           // 目前場次
  next: 'auto',        // 下一場：'auto' 自動、'none' 不顯示、或場次編號
  dur: { vs: 6, live: 15, next: 6, result: 8 },
  loop: true,          // 「正在比賽中」與「下一場請準備」是否循環
  tpl: {
    vs: '{A} VS {B}',
    live: '{A} VS {B}',
    liveTag: '正在比賽中',
    next: '下一場 {A} VS {B} 請準備',
    result: '{W} 獲勝！',
    champ: '恭喜 {W} 奪得冠軍！',
    idle: '',
  },
  custom: '',
  look: 'board',       // 看板樣式：board 一般 / marquee 跑馬燈
  speed: 'normal',     // 跑馬燈速度：slow / normal / fast
  extra: '',           // 額外顯示句子（一行一句，可用 {日期}{星期}{時間}… 即時代碼）
  extraOn: true,
  extraEvery: 6,       // 一般樣式：額外句子幾秒換一句
  draw: null,          // 直播抽籤：{ kind: start/pair/solo, n, pairs, total, leaves, names, fx, tumble, hold, pool, last, at } 或 { done }
};

// 抽籤球動畫的時間軸（秒）：滾動 → 吐出兩顆球 → 停留 → 飛進賽程表
export const DRAW_FX = { tumble: 3, hold: 2.5, exit: 1.1, fly: 0.7 };
const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};
export function drawTiming(d) {
  const tumble = clampNum(d && d.tumble, 1, 10, DRAW_FX.tumble);
  const hold = clampNum(d && d.hold, 0.5, 15, DRAW_FX.hold);
  const { exit, fly } = DRAW_FX;
  const showAt = tumble + exit * 0.85;           // 兩顆球上出現隊名
  const revealAt = tumble + exit + hold + fly;   // 球飛進賽程表，前台賽程揭曉
  return { tumble, exit, hold, fly, showAt, revealAt, end: revealAt + 0.25 };
}
export const DRAW_DONE_DELAY = 4.5; // 最後一步揭曉後幾秒，看板自動換成「抽籤完成」

// ── 額外顯示句子：{日期} {星期} {時間} {年} {月} {日} {時} {分} {秒} {T}（賽事標題）──
const WEEK = '日一二三四五六';
export const LIVE_TOKENS = ['日期', '星期', '時間', '年', '月', '日', '時', '分', '秒', 'T'];
export function liveText(tpl, nowMs, title = '') {
  const d = new Date(nowMs);
  const p2 = (n) => String(n).padStart(2, '0');
  const v = {
    日期: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
    星期: `星期${WEEK[d.getDay()]}`,
    時間: `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`,
    年: String(d.getFullYear()),
    月: String(d.getMonth() + 1),
    日: String(d.getDate()),
    時: p2(d.getHours()),
    分: p2(d.getMinutes()),
    秒: p2(d.getSeconds()),
    T: title || '',
  };
  return String(tpl || '').replace(/\{(日期|星期|時間|年|月|日|時|分|秒|T)\}/g, (_, k) => v[k]);
}
export function extraLines(b) {
  if (!b || b.extraOn === false) return [];
  return String(b.extra || '').split(/\n/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
}
// 一般樣式輪流顯示第幾句（用伺服器時間算，所有螢幕同步）
export function extraIndex(b, nowMs, n) {
  if (!n) return 0;
  const every = clampNum(b && b.extraEvery, 2, 120, 6);
  return Math.floor(nowMs / (every * 1000)) % n;
}

export function withDefaults(b) {
  const o = Object.assign({}, BANNER_DEFAULTS, b || {});
  o.dur = Object.assign({}, BANNER_DEFAULTS.dur, (b && b.dur) || {});
  o.tpl = Object.assign({}, BANNER_DEFAULTS.tpl, (b && b.tpl) || {});
  return o;
}

export function resolveNext(b, A) {
  if (!A) return null;
  if (b.next === 'none') return null;
  if (b.next && b.next !== 'auto') {
    const n = getNode(A, b.next);
    if (n && n.type === 'match' && n.ready && !n.done && String(n.id) !== String(b.cur)) return n;
    // 指定的下一場已經打完（或變成目前場次）：改回自動找下一場
  }
  return nextMatch(A, b.cur);
}

export function bannerPhase(b0, now, hasNext) {
  const b = withDefaults(b0);
  const t = Math.max(0, (now - (b.at || 0)) / 1000);
  const d = b.dur;
  switch (b.mode) {
    case 'flow': {
      if (t < d.vs) return { phase: 'vs', left: d.vs - t };
      const t2 = t - d.vs;
      if (!hasNext || d.next <= 0) return { phase: 'live' };
      const cycle = d.live + d.next;
      if (b.loop === false) {
        if (t2 < d.live) return { phase: 'live' };
        if (t2 < cycle) return { phase: 'next' };
        return { phase: 'live' };
      }
      return (t2 % cycle) < d.live ? { phase: 'live' } : { phase: 'next' };
    }
    case 'result':
      return t < d.result ? { phase: 'result' } : { phase: hasNext ? 'prep' : 'idle' };
    case 'custom': return { phase: 'custom' };
    case 'draw': return { phase: 'draw' };
    default: return { phase: 'idle' };
  }
}

// 看板內容需要的資料（目前場次、下一場、現在是哪個階段…）
function viewCtx(b0, { bracket, settings, now }) {
  const b = withDefaults(b0);
  const A = bracket ? analyze(bracket) : null;
  const names = (bracket && bracket.names) || {};
  const nm = (id) => (id && id !== '?' ? (names[id] || '未命名隊伍') : '待定');
  const cur = A && b.cur != null ? getNode(A, b.cur) : null;
  const nxt = resolveNext(b, A);
  let { phase } = bannerPhase(b, now, !!nxt);
  // 目前場次已經打完：不再回到「VS／正在比賽中」，改成一直顯示下一場請準備（沒有下一場就顯示結果）
  if (b.mode === 'flow' && cur && cur.done) phase = nxt ? 'prep' : 'result';
  const title = (settings && settings.title) || ''; // 留空 = 前台不顯示標題
  const sub = (settings && settings.subtitle) || '';
  const roundOf = (n) => (A && n ? matchTitle(A, n) : '');
  return { b, A, nm, cur, nxt, phase, title, sub, roundOf, now };
}

// 每種內容：html = 一般看板用，line = 跑馬燈用的一行文字
const kick = (t) => (t ? `<span class="mq-kick">${esc(t)}</span>` : '');
const mqPill = (cls, t) => `<span class="bn-pill mq-pill ${cls}">${cls === 'live' ? '<i></i>' : ''}${esc(t)}</span>`;
const V = {
  idle(c, center = true) {
    const { b, title, sub, now } = c;
    const text = b.tpl.idle || title;
    if (text || sub) {
      return {
        key: `idle|${text}|${sub}`, cls: 'is-idle',
        html: `<div class="bn-idle">${text ? `<div class="bn-title fit">${esc(text)}</div>` : ''}${sub ? `<div class="bn-sub fit">${esc(sub)}</div>` : ''}</div>`,
        line: `${text ? `<span class="tk-txt">${esc(text)}</span>` : ''}${sub ? `<span class="mq-kick mq-sub">${esc(sub)}</span>` : ''}`,
      };
    }
    // 沒有標題：有額外句子就放中間，沒有就整個留空
    const ex = extraLines(b);
    if (ex.length && center) {
      const i = extraIndex(b, now, ex.length);
      return { key: `idle|x|${i}|${ex[i]}`, cls: 'is-idle', extraInCenter: true, html: `<div class="bn-idle"><div class="bn-title fit" data-live="${esc(ex[i])}"></div></div>`, line: '' };
    }
    return { key: 'idle|blank', cls: 'is-idle is-blank', html: '', line: '' };
  },
  vs(c) {
    const { cur, nm, b, roundOf } = c;
    const t = matchLineOf(c, b.tpl.vs, cur);
    return { key: `vs|${cur.id}|${b.at}|${nm(cur.ent[0])}|${nm(cur.ent[1])}|${b.tpl.vs}`, cls: 'is-vs', html: `<div class="bn-kicker">${esc(roundOf(cur))}</div><div class="bn-line bn-big fit">${t}</div>`, line: `${kick(roundOf(cur))}${t}` };
  },
  live(c) {
    const { cur, nm, b, roundOf } = c;
    const t = matchLineOf(c, b.tpl.live, cur);
    const tag = b.tpl.liveTag || '正在比賽中';
    return {
      key: `live|${cur.id}|${nm(cur.ent[0])}|${nm(cur.ent[1])}|${b.tpl.live}|${b.tpl.liveTag}`, cls: 'is-live',
      html: `<div class="bn-pill live"><i></i>${esc(tag)}</div><div class="bn-kicker sm">${esc(roundOf(cur))}</div><div class="bn-line bn-mid fit">${t}</div>`,
      line: `${mqPill('live', tag)}${kick(roundOf(cur))}${t}`,
    };
  },
  next(c, phase) {
    const { nxt, nm, b, roundOf } = c;
    const t = matchLineOf(c, b.tpl.next, nxt);
    const k = `${roundOf(nxt)}${nxt.time ? `｜${nxt.time}` : ''}`;
    return {
      key: `next|${nxt.id}|${nm(nxt.ent[0])}|${nm(nxt.ent[1])}|${b.tpl.next}|${phase}`, cls: 'is-next',
      html: `<div class="bn-pill next">NEXT</div><div class="bn-kicker sm">${esc(k)}</div><div class="bn-line bn-mid fit">${t}</div>`,
      line: `${mqPill('next', 'NEXT')}${kick(k)}${t}`,
    };
  },
  result(c) {
    const { cur, nm, b, roundOf, title } = c;
    const isFinal = cur.p === 1;
    const tpl = isFinal ? b.tpl.champ : b.tpl.result;
    const k = `${roundOf(cur)}${cur.score ? `｜${cur.score[0]} : ${cur.score[1]}` : ''}`;
    const t = `${isFinal ? '<span class="bn-trophy">🏆</span>' : ''}${renderTpl(tpl, { W: nm(cur.winner), A: nm(cur.ent[0]), B: nm(cur.ent[1]), R: roundOf(cur), T: title })}`;
    return { key: `result|${cur.id}|${cur.winner}|${tpl}`, cls: isFinal ? 'is-champ' : 'is-result', html: `<div class="bn-kicker">${esc(k)}</div><div class="bn-line bn-big fit">${t}</div>`, line: `${kick(k)}${t}` };
  },
  custom(c) {
    const { b } = c;
    const ls = String(b.custom).split(/\n/).map((x) => x.trim()).filter(Boolean);
    const lines = ls.slice(0, 3).map((l) => `<div class="bn-cline fit">${esc(l)}</div>`).join('');
    return { key: `custom|${b.custom}|${b.at}`, cls: 'is-custom', html: `<div class="bn-custom">${lines}</div>`, line: ls.map((l) => `<span class="tk-txt">${esc(l)}</span>`).join('<span class="mq-gap"></span>') };
  },
  draw(c) {
    const { b, nm, now } = c;
    const d = b.draw;
    const el = d.at ? Math.max(0, (now - d.at) / 1000) : Infinity;
    const tm = drawTiming(d);
    const fxOn = d.kind === 'pair' && !!d.fx;
    const pill = (t) => `<div class="bn-pill draw">${esc(t)}</div>`;
    if (d.done || (d.last && el >= (fxOn ? tm.revealAt : 0) + DRAW_DONE_DELAY)) {
      const t = `<span class="tk-txt">共 ${esc(d.total)} 隊，完整賽程已公布</span>`;
      return { key: `drawdone|${d.total}`, cls: 'is-draw', html: `${pill('抽籤完成')}<div class="bn-line bn-mid fit">${t}</div>`, line: `${mqPill('draw', '抽籤完成')}${t}` };
    }
    if (d.kind === 'start') {
      const t = '<span class="tk-txt">即將開始抽籤</span>';
      return { key: `drawstart|${d.total}|${d.at}`, cls: 'is-draw', html: `${pill('抽籤')}<div class="bn-kicker">共 ${esc(d.total)} 隊</div><div class="bn-line bn-mid fit">${t}</div>`, line: `${mqPill('draw', '抽籤')}${kick(`共 ${d.total} 隊`)}${t}` };
    }
    if (d.kind === 'pair') {
      const masked = fxOn && el < tm.showAt;
      const [na, nb] = [0, 1].map((i) => (d.names && d.names[i]) || '未命名隊伍');
      const k = `第 ${d.n} 組 ／ 共 ${d.pairs} 組`;
      const head = `${pill('抽籤進行中')}<div class="bn-kicker">${esc(k)}</div>`;
      if (masked) {
        const t = '<span class="tk tA dq">？</span><span class="tk-txt"> </span><span class="tk-vs">VS</span><span class="tk-txt"> </span><span class="tk tB dq">？</span>';
        return { key: `drawpair|${d.at}|${d.n}|m`, cls: 'is-draw', html: `${head}<div class="bn-line bn-big fit">${t}</div>`, line: `${mqPill('draw', '抽籤進行中')}${kick(k)}${t}` };
      }
      const t = renderTpl('{A} VS {B}', { A: na, B: nb });
      return { key: `drawpair|${d.at}|${d.n}|r`, cls: 'is-draw is-vs', html: `${head}<div class="bn-line bn-big fit">${t}</div>`, line: `${mqPill('draw', '抽籤進行中')}${kick(k)}${t}` };
    }
    if (d.kind === 'solo') {
      const list = (d.names || []).map((x) => `<span class="tk tW">${esc(x || '未命名隊伍')}</span>`).join('<span class="tk-txt">、</span>');
      const label = (d.names || []).length > 1 ? `剩下的 ${(d.names || []).length} 隊` : '最後一隊';
      const k = `${label} ／ 第 1 輪輪空，直接晉級下一輪`;
      return { key: `drawsolo|${d.at}`, cls: 'is-draw', html: `${pill('抽籤進行中')}<div class="bn-kicker">${esc(k)}</div><div class="bn-line bn-big fit">${list}</div>`, line: `${mqPill('draw', '抽籤進行中')}${kick(k)}${list}` };
    }
    const tn = d.name || (d.team ? nm(d.team) : '');
    const t = tn ? `<span class="tk-txt">第 ${esc(d.n)} 籤：</span><span class="tk tW">${esc(tn)}</span>` : '<span class="tk-txt">即將開始抽籤</span>';
    return {
      key: `draw|${d.n}|${d.team || ''}`, cls: 'is-draw',
      html: `<div class="bn-pill draw">抽籤進行中 ${esc(d.n || 0)} / ${esc(d.total || 0)}</div><div class="bn-line ${tn ? 'bn-big' : 'bn-mid'} fit">${t}</div>`,
      line: `${mqPill('draw', '抽籤進行中')}${t}`,
    };
  },
};
function matchLineOf(c, tpl, n) {
  return renderTpl(tpl, { A: c.nm(n.ent[0]), B: c.nm(n.ent[1]), R: c.roundOf(n), T: c.title });
}

// 產生看板內容；key 改變時前台才會重畫（觸發進場動畫）
export function bannerView(b0, opts) {
  const c = viewCtx(b0, opts);
  const { phase, cur, nxt, b } = c;
  if (phase === 'vs' && cur) return V.vs(c);
  if ((phase === 'live' || (phase === 'vs' && !cur)) && cur) return V.live(c);
  if ((phase === 'next' || phase === 'prep') && nxt) return V.next(c, phase);
  if (phase === 'result' && cur && cur.done) return V.result(c);
  if (phase === 'custom' && b.custom) return V.custom(c);
  if (phase === 'draw' && b.draw) return V.draw(c);
  return V.idle(c);
}

// 跑馬燈：依目前狀態列出要輪流捲動的句子（比賽中＋下一場＋額外句子…，不受「幾秒換畫面」影響）
export function marqueeSegments(b0, opts) {
  const c = viewCtx(b0, opts);
  const { b, cur, nxt } = c;
  const segs = [];
  const push = (v) => { if (v && v.line) segs.push({ key: v.key, html: v.line }); };
  if (b.mode === 'flow' || b.mode === 'result') {
    if (cur && cur.done) push(V.result(c));
    else if (cur && b.mode === 'flow') push(V.live(c));
    if (nxt) push(V.next(c, b.mode === 'flow' && cur && !cur.done ? 'next' : 'prep'));
  } else if (b.mode === 'custom' && b.custom) push(V.custom(c));
  else if (b.mode === 'draw' && b.draw) push(V.draw(c));
  if (!segs.length) push(V.idle(c, false));
  extraLines(b).forEach((tpl, i) => segs.push({ key: `x|${i}|${tpl}`, live: tpl }));
  return segs;
}
