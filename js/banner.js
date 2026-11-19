// banner.js — 頂端固定顯示屏（通知看板）：VS → 正在比賽中 → 下一場請準備 …，所有時間與文字都可在後台設定
import { analyze, getNode, nextMatch, matchTitle } from './bracket.js';
import { esc, renderTpl } from './util.js';

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
    return n && n.ready && !n.done && String(n.id) !== String(b.cur) ? n : null;
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

// 產生看板內容；key 改變時前台才會重畫（觸發進場動畫）
export function bannerView(b0, { bracket, settings, now }) {
  const b = withDefaults(b0);
  const A = bracket ? analyze(bracket) : null;
  const names = (bracket && bracket.names) || {};
  const nm = (id) => (id && id !== '?' ? (names[id] || '未命名隊伍') : '待定');
  const cur = A && b.cur != null ? getNode(A, b.cur) : null;
  const nxt = resolveNext(b, A);
  const { phase } = bannerPhase(b, now, !!nxt);
  const title = (settings && settings.title) || '狂想之息 比賽';
  const sub = (settings && settings.subtitle) || '';
  const roundOf = (n) => (A && n ? matchTitle(A, n) : '');

  const idle = () => {
    const text = b.tpl.idle || title;
    return {
      key: `idle|${text}|${sub}`, cls: 'is-idle',
      html: `<div class="bn-idle"><div class="bn-title fit">${esc(text)}</div>${sub ? `<div class="bn-sub fit">${esc(sub)}</div>` : ''}</div>`,
    };
  };
  const matchLine = (tpl, n, extra = {}) => renderTpl(tpl, Object.assign({ A: nm(n.ent[0]), B: nm(n.ent[1]), R: roundOf(n), T: title }, extra));

  if (phase === 'vs' && cur) {
    return {
      key: `vs|${cur.id}|${b.at}|${nm(cur.ent[0])}|${nm(cur.ent[1])}`, cls: 'is-vs',
      html: `<div class="bn-kicker">${esc(roundOf(cur))}</div><div class="bn-line bn-big fit">${matchLine(b.tpl.vs, cur)}</div>`,
    };
  }
  if ((phase === 'live' || (phase === 'vs' && !cur)) && cur) {
    return {
      key: `live|${cur.id}|${nm(cur.ent[0])}|${nm(cur.ent[1])}|${b.tpl.live}|${b.tpl.liveTag}`, cls: 'is-live',
      html: `<div class="bn-pill live"><i></i>${esc(b.tpl.liveTag || '正在比賽中')}</div><div class="bn-kicker sm">${esc(roundOf(cur))}</div><div class="bn-line bn-mid fit">${matchLine(b.tpl.live, cur)}</div>`,
    };
  }
  if ((phase === 'next' || phase === 'prep') && nxt) {
    return {
      key: `next|${nxt.id}|${nm(nxt.ent[0])}|${nm(nxt.ent[1])}|${b.tpl.next}|${phase}`, cls: 'is-next',
      html: `<div class="bn-pill next">NEXT</div><div class="bn-kicker sm">${esc(roundOf(nxt))}${nxt.time ? `｜${esc(nxt.time)}` : ''}</div><div class="bn-line bn-mid fit">${matchLine(b.tpl.next, nxt)}</div>`,
    };
  }
  if (phase === 'result' && cur && cur.done) {
    const isFinal = cur.p === 1;
    const tpl = isFinal ? b.tpl.champ : b.tpl.result;
    return {
      key: `result|${cur.id}|${cur.winner}|${tpl}`, cls: isFinal ? 'is-champ' : 'is-result',
      html: `<div class="bn-kicker">${esc(roundOf(cur))}${cur.score ? `｜${esc(cur.score[0])} : ${esc(cur.score[1])}` : ''}</div><div class="bn-line bn-big fit">${isFinal ? '<span class="bn-trophy">🏆</span>' : ''}${renderTpl(tpl, { W: nm(cur.winner), A: nm(cur.ent[0]), B: nm(cur.ent[1]), R: roundOf(cur), T: title })}</div>`,
    };
  }
  if (phase === 'custom' && b.custom) {
    const lines = String(b.custom).split(/\n/).slice(0, 3).map((l) => `<div class="bn-cline fit">${esc(l)}</div>`).join('');
    return { key: `custom|${b.custom}|${b.at}`, cls: 'is-custom', html: `<div class="bn-custom">${lines}</div>` };
  }
  if (phase === 'draw' && b.draw) {
    const d = b.draw;
    const el = d.at ? Math.max(0, (now - d.at) / 1000) : Infinity;
    const tm = drawTiming(d);
    const fxOn = d.kind === 'pair' && !!d.fx;
    const pill = (t) => `<div class="bn-pill draw">${esc(t)}</div>`;
    if (d.done || (d.last && el >= (fxOn ? tm.revealAt : 0) + DRAW_DONE_DELAY)) {
      return { key: `drawdone|${d.total}`, cls: 'is-draw', html: `${pill('抽籤完成')}<div class="bn-line bn-mid fit"><span class="tk-txt">共 ${esc(d.total)} 隊，完整賽程已公布</span></div>` };
    }
    if (d.kind === 'start') {
      return { key: `drawstart|${d.total}|${d.at}`, cls: 'is-draw', html: `${pill('抽籤')}<div class="bn-kicker">共 ${esc(d.total)} 隊</div><div class="bn-line bn-mid fit"><span class="tk-txt">即將開始抽籤</span></div>` };
    }
    if (d.kind === 'pair') {
      const masked = fxOn && el < tm.showAt;
      const [na, nb] = [0, 1].map((i) => (d.names && d.names[i]) || '未命名隊伍');
      const head = `${pill('抽籤進行中')}<div class="bn-kicker">第 ${esc(d.n)} 組 ／ 共 ${esc(d.pairs)} 組</div>`;
      if (masked) {
        return { key: `drawpair|${d.at}|${d.n}|m`, cls: 'is-draw', html: `${head}<div class="bn-line bn-big fit"><span class="tk tA dq">？</span><span class="tk-txt"> </span><span class="tk-vs">VS</span><span class="tk-txt"> </span><span class="tk tB dq">？</span></div>` };
      }
      return { key: `drawpair|${d.at}|${d.n}|r`, cls: 'is-draw is-vs', html: `${head}<div class="bn-line bn-big fit">${renderTpl('{A} VS {B}', { A: na, B: nb })}</div>` };
    }
    if (d.kind === 'solo') {
      const list = (d.names || []).map((x) => `<span class="tk tW">${esc(x || '未命名隊伍')}</span>`).join('<span class="tk-txt">、</span>');
      const label = (d.names || []).length > 1 ? `剩下的 ${(d.names || []).length} 隊` : '最後一隊';
      return { key: `drawsolo|${d.at}`, cls: 'is-draw', html: `${pill('抽籤進行中')}<div class="bn-kicker">${label} ／ 第 1 輪輪空，直接晉級下一輪</div><div class="bn-line bn-big fit">${list}</div>` };
    }
    const tn = d.name || (d.team ? nm(d.team) : '');
    return {
      key: `draw|${d.n}|${d.team || ''}`, cls: 'is-draw',
      html: `<div class="bn-pill draw">抽籤進行中 ${esc(d.n || 0)} / ${esc(d.total || 0)}</div>${tn ? `<div class="bn-line bn-big fit"><span class="tk-txt">第 ${esc(d.n)} 籤：</span><span class="tk tW">${esc(tn)}</span></div>` : `<div class="bn-line bn-mid fit"><span class="tk-txt">即將開始抽籤</span></div>`}`,
    };
  }
  return idle();
}
