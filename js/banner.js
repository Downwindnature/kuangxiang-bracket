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
  draw: null,          // { n, total, team, done }
};

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
    if (d.done) {
      return { key: `drawdone|${d.total}`, cls: 'is-draw', html: `<div class="bn-pill draw">抽籤完成</div><div class="bn-line bn-mid fit"><span class="tk-txt">共 ${esc(d.total)} 隊，完整賽程已公布</span></div>` };
    }
    const tn = d.name || (d.team ? nm(d.team) : '');
    return {
      key: `draw|${d.n}|${d.team || ''}`, cls: 'is-draw',
      html: `<div class="bn-pill draw">抽籤進行中 ${esc(d.n || 0)} / ${esc(d.total || 0)}</div>${tn ? `<div class="bn-line bn-big fit"><span class="tk-txt">第 ${esc(d.n)} 籤：</span><span class="tk tW">${esc(tn)}</span></div>` : `<div class="bn-line bn-mid fit"><span class="tk-txt">即將開始抽籤</span></div>`}`,
    };
  }
  return idle();
}
