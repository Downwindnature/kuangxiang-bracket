// bannerui.js — 把看板內容畫到畫面上（前台、後台預覽、抽籤球畫面共用）
// 一般樣式：內容換了才重畫（有進場動畫），額外句子放右下角輪流顯示
// 跑馬燈樣式：所有句子排成一列由右往左捲動；內容換了（換場、公布結果…）就淡出、從頭換成新內容
import { bannerView, marqueeSegments, withDefaults, liveText, extraLines, extraIndex } from './banner.js?v=2628f905';
import { fitText } from './util.js?v=2628f905';

const SPEED = { slow: 90, normal: 150, fast: 230 };
export function marqueeSpeed(v) {
  if (SPEED[v]) return SPEED[v];
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(40, Math.min(400, n)) : SPEED.normal;
}

export function createBannerUI(el, { now = () => Date.now(), base = 'banner' } = {}) {
  let look = '';
  let ctx = null;         // 最新的 { banner, bracket, settings }
  let inner = null;       // 一般樣式的內容
  let lastKey = '';
  let corner = null;      // 一般樣式右下角的額外句子
  let cornerTpl = null;
  let mq = null;          // 跑馬燈
  let lastMain = '';
  let liveAt = 0;

  const title = () => (ctx && ctx.settings && ctx.settings.title) || '';
  const fillLive = (root, t) => {
    root.querySelectorAll('[data-live]').forEach((x) => {
      const s = liveText(x.dataset.live, t, title());
      if (x.textContent !== s) x.textContent = s;
    });
  };
  const opts = (t) => ({ bracket: ctx.bracket, settings: ctx.settings, now: t });

  function teardown() {
    if (mq) { mq.destroy(); mq = null; }
    if (inner) { inner.remove(); inner = null; }
    if (corner) { corner.remove(); corner = null; }
    el.replaceChildren(); // 清掉頁面原本放的空白內容
    cornerTpl = null;
    lastKey = '';
    lastMain = '';
  }

  // ── 一般樣式 ──
  function board(t) {
    const b = withDefaults(ctx.banner);
    const v = bannerView(ctx.banner, opts(t));
    // 額外句子（待機又沒有標題時已經放在正中間，就不再放右下角）
    const lines = v.extraInCenter ? [] : extraLines(b);
    const cls = `${base} ${v.cls}${lines.length ? ' has-extra' : ''}`;
    if (el.className !== cls) el.className = cls;
    if (v.key !== lastKey) {
      lastKey = v.key;
      const nx = document.createElement('div');
      nx.className = 'bn-inner enter';
      nx.innerHTML = v.html;
      if (inner) inner.replaceWith(nx); else el.prepend(nx);
      inner = nx;
      fillLive(nx, t);
      nx.querySelectorAll('.fit').forEach((e) => fitText(e, { min: 0.4 }));
    } else if (inner) fillLive(inner, t);
    if (!lines.length) {
      if (corner) { corner.remove(); corner = null; cornerTpl = null; }
      return;
    }
    const tpl = lines[extraIndex(b, t, lines.length)];
    if (!corner) {
      corner = document.createElement('div');
      corner.className = 'bn-extra';
      el.appendChild(corner);
    }
    if (tpl !== cornerTpl) {
      cornerTpl = tpl;
      corner.innerHTML = '<span class="bn-extra-t fit"></span>';
      corner.firstChild.dataset.live = tpl;
      fillLive(corner, t);
      fitText(corner.firstChild, { min: 0.55 });
    } else fillLive(corner, t);
  }

  // ── 跑馬燈 ──
  const mainKey = (t) => marqueeSegments(ctx.banner, opts(t)).filter((s) => s.live == null).map((s) => s.key).join('§');
  function marquee(t) {
    const b = withDefaults(ctx.banner);
    const main = mainKey(t);
    if (!mq) {
      el.className = `${base} is-marquee`;
      mq = createMarquee(el, {
        segments: () => marqueeSegments(ctx.banner, opts(now())),
        fill: (root) => fillLive(root, now()),
      });
      lastMain = main;
    } else if (main !== lastMain) {
      lastMain = main;
      mq.restart(); // 換場、公布結果、抽出下一組…：馬上換成新內容
    }
    mq.speed = marqueeSpeed(b.speed);
    if (Math.abs(t - liveAt) > 200) { liveAt = t; mq.refreshLive(); }
  }

  return {
    update(next) {
      ctx = next;
      const t = now();
      const want = withDefaults(ctx.banner).look === 'marquee' ? 'marquee' : 'board';
      if (want !== look) { teardown(); look = want; }
      if (look === 'board') board(t); else marquee(t);
    },
    // 強制重畫（後台按儲存後讓預覽重新播一次進場動畫）
    reset() {
      lastKey = '';
      cornerTpl = null;
      if (mq) mq.restart();
    },
    destroy() { teardown(); look = ''; },
  };
}

// 跑馬燈引擎：句子一段一段接在後面，捲出畫面的就拿掉
const START_X = 60;    // 新內容從左邊這裡開始（馬上看得到）
const START_HOLD = 1500; // 先停一下再開始往左捲（毫秒）
function createMarquee(host, { segments, fill }) {
  const box = document.createElement('div');
  box.className = 'mq-box';
  host.appendChild(box);
  let track = null;
  let items = [];
  let x = START_X;
  let cursor = 0;
  let fading = [];        // 淡出中的舊內容（繼續往左捲）
  let holdUntil = 0;
  let last = performance.now();
  let raf = 0;

  function newTrack() {
    track = document.createElement('div');
    track.className = 'mq-track';
    box.appendChild(track);
    items = [];
    cursor = 0;
    x = START_X;
    holdUntil = performance.now() + START_HOLD;
  }
  newTrack();

  function append() {
    const segs = segments();
    if (!segs.length) return false;
    const seg = segs[cursor % segs.length];
    cursor = (cursor + 1) % segs.length;
    const it = document.createElement('span');
    it.className = 'mq-item';
    it.innerHTML = `<span class="bn-line mq-line">${seg.live != null ? '<span class="tk-txt mq-live"></span>' : seg.html}</span><span class="mq-sep">✦</span>`;
    if (seg.live != null) it.querySelector('.mq-live').dataset.live = seg.live;
    track.appendChild(it);
    fill(it);
    items.push({ el: it, w: it.offsetWidth });
    return true;
  }

  function frame(tNow) {
    const dt = Math.min(0.1, Math.max(0, (tNow - last) / 1000));
    last = tNow;
    const W = box.clientWidth || 1;
    const dx = api.speed * dt;
    if (tNow >= holdUntil) x -= dx;
    while (items.length && x + items[0].w < 0) {
      x += items[0].w;
      items[0].el.remove();
      items.shift();
    }
    if (!items.length) x = Math.max(x, START_X);
    let total = items.reduce((a, i) => a + i.w, 0);
    let guard = 0;
    while (x + total < W + 40 && guard++ < 12) {
      if (!append()) break;
      total += items[items.length - 1].w;
    }
    track.style.transform = `translate3d(${x.toFixed(1)}px, -50%, 0)`;
    fading.forEach((f) => { f.x -= dx; f.el.style.transform = `translate3d(${f.x.toFixed(1)}px, -50%, 0)`; });
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const api = {
    speed: SPEED.normal,
    restart() {
      if (items.length) {
        const f = { el: track, x };
        f.el.classList.add('mq-out');
        fading.push(f);
        setTimeout(() => { f.el.remove(); fading = fading.filter((o) => o !== f); }, 450);
      } else track.remove();
      newTrack();
      track.classList.add('mq-in');
    },
    refreshLive() {
      fill(track);
      items.forEach((i) => { i.w = i.el.offsetWidth; }); // 字型載入、時間變動後重新量寬度
    },
    destroy() {
      cancelAnimationFrame(raf);
      box.remove();
    },
  };
  return api;
}
