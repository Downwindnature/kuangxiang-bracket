// admin/page-drawball.js — 全螢幕抽籤球畫面：直播抽籤時，後台整個變成抽籤球（其他部分都隱藏）
import { S, teamNames } from './state.js?v=c2f13502';
import { publicView, teamCount } from '../bracket.js?v=c2f13502';
import { createBannerUI } from '../bannerui.js?v=c2f13502';
import { createDrawFx, drawMask } from '../drawfx.js?v=c2f13502';
import { esc } from '../util.js?v=c2f13502';
import * as L from './livedraw.js?v=c2f13502';

// 舞台 1920×1080：抽獎球放左邊中間，右邊是「已抽出」清單
const GEOM = { cx: 760, cy: 600, scale: 0.88, slots: [{ x: 380, y: 590 }, { x: 1140, y: 590 }], titleTop: 196 };

let root = null;
let fx = null;
let timer = null;
let onResize = null;
let bannerUI = null;
let lastListKey = '';
let lastMasked = [];

export function cleanup() {
  L.stopAuto();
  L.bindView(null);
  clearInterval(timer);
  timer = null;
  if (onResize) removeEventListener('resize', onResize);
  onResize = null;
  if (fx) fx.destroy();
  fx = null;
  if (bannerUI) bannerUI.destroy();
  bannerUI = null;
  // 按「回到後台」（或瀏覽器的上一頁）回到選手抽籤時，直接停在「③ 公布到顯示屏」
  if (root && location.hash === '#draw') S.ui.scrollTo = 's3';
  if (root) root.remove();
  root = null;
  document.body.classList.remove('fs-draw');
}

const pubBracket = () => (S.bracket ? publicView(S.bracket, teamNames(), S.bracket.reveal) : null);

export function render(main) {
  cleanup();
  main.innerHTML = '';
  document.body.classList.add('fs-draw');
  lastListKey = '';
  lastMasked = [];
  root = document.createElement('div');
  root.className = 'dball';
  root.innerHTML = `
    <div class="space-bg dball-bg" aria-hidden="true"><div class="horizon"></div><div class="grid-wrap"><div class="grid-plane"></div></div></div>
    <div class="dball-vp"><div class="dball-stage">
      <section class="banner"><div class="bn-inner"></div></section>
      <div class="dball-msg" hidden></div>
      <aside class="dball-panel"><h4>已抽出<small></small></h4><div class="dball-list"></div></aside>
      <div class="dball-ctrl">
        <button id="dbNext" class="primary"></button>
        <button id="dbAuto"></button>
        <button id="dbAll" class="ghost">直接全部揭曉</button>
      </div>
      <div class="dball-nav">
        <a class="btn" id="dbBack" href="#draw">← 回到後台</a>
        <a class="btn" id="dbFront" href="index.html${esc(location.search)}">到前台 →</a>
      </div>
    </div></div>`;
  document.body.appendChild(root);
  const stage = root.querySelector('.dball-stage');
  const fit = () => {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
  };
  fit();
  onResize = () => { fit(); if (fx) fx.repaint(); };
  addEventListener('resize', onResize);
  const list = root.querySelector('.dball-list');
  bannerUI = createBannerUI(root.querySelector('.banner'), { now: () => S.store.now() });
  fx = createDrawFx(stage, { now: () => S.store.now(), board: list, persistent: true, backdrop: false, geom: GEOM, onFrame: () => refreshText() });

  root.querySelector('#dbNext').onclick = async () => {
    const info = L.liveInfo();
    if (info.revealing && info.steps) await L.drawNext();
    else if (info.legacy) await L.revealAllNow();
    else await L.startLiveDraw();
    refresh();
  };
  root.querySelector('#dbAuto').onclick = () => { L.toggleAuto(); refresh(); };
  root.querySelector('#dbAll').onclick = async () => { await L.revealAllNow(); refresh(); };
  L.bindView(() => refresh());
  refresh();
  timer = setInterval(refresh, 200);
}

// 抽獎球裡要有幾顆球：還沒開始 = 全部隊伍、抽籤中 = 還沒抽出的隊伍、抽完 = 0
function poolNow(info) {
  if (!info.br) return 0;
  if (info.revealing) return info.pool;
  return info.br.published ? 0 : teamCount(info.br);
}

function refresh() {
  if (!root) return;
  fx.sync(S.banner);
  const info = L.liveInfo();
  fx.setIdle(poolNow(info));
  refreshText(info);
}

function refreshText(info = L.liveInfo()) {
  if (!root) return;
  const now = S.store.now();
  // 上方看板（跟前台一樣，一般樣式／跑馬燈樣式）
  bannerUI.update({ banner: S.banner, bracket: pubBracket(), settings: S.settings });
  // 右邊「已抽出」清單：正在播動畫的那一組先顯示「？」，球飛進來的時候才揭曉
  const mask = drawMask(S.banner, now) || [];
  const drawn = L.drawnList();
  const key = JSON.stringify([drawn, mask]);
  if (key !== lastListKey) {
    lastListKey = key;
    const unmasked = lastMasked.filter((l) => !mask.includes(l));
    lastMasked = mask.slice();
    const listEl = root.querySelector('.dball-list');
    const nm = (d, i) => {
      const l = d.leaves[i];
      const q = mask.includes(l);
      return `<span class="dl-t ${d.pair ? (i ? 'b' : 'a') : ''} ${q ? 'q' : ''}" data-leaf="${l}">${q ? '？' : esc(d.names[i])}</span>`;
    };
    listEl.innerHTML = drawn.length
      ? drawn.map((d) => {
        const flash = d.leaves.some((l) => unmasked.includes(l)) ? ' flash' : '';
        if (d.pair) return `<div class="dl-item${flash}"><span class="dl-n">第 ${d.n} 組</span>${nm(d, 0)}<span class="dl-vs">VS</span>${nm(d, 1)}</div>`;
        return `<div class="dl-item solo${flash}"><span class="dl-n">${d.names.length > 1 ? '剩下的隊伍' : '最後一隊'}</span><span class="dl-t solo-list">${d.leaves.map((l, i) => `<span data-leaf="${l}">${esc(d.names[i])}</span>`).join('、')}</span></div>`;
      }).join('')
      : '<p class="dball-empty">還沒有抽出任何一組</p>';
    root.querySelector('.dball-panel h4 small').textContent = info.br ? `${info.pairsShown} / ${info.pairsTotal} 組` : '';
  }
  // 按鈕
  const next = root.querySelector('#dbNext');
  const auto = root.querySelector('#dbAuto');
  const all = root.querySelector('#dbAll');
  const msg = root.querySelector('.dball-msg');
  const left = L.busyLeftMs();
  if (!info.br) {
    next.hidden = true;
    auto.hidden = true;
    all.hidden = true;
    msg.hidden = false;
    msg.textContent = '還沒有賽程，請先回到後台的「選手抽籤」抽籤。';
    return;
  }
  msg.hidden = true;
  next.hidden = false;
  const drawing = info.revealing && !!info.steps;
  auto.hidden = !drawing;
  all.hidden = !(drawing || info.legacy);
  if (drawing) {
    next.disabled = left > 0;
    next.textContent = left > 0 ? `抽籤中…（${Math.ceil(left / 1000)} 秒）` : info.label;
    auto.textContent = L.isAuto() ? '⏸ 暫停自動抽籤' : '▶ 自動抽籤';
  } else if (info.legacy) {
    next.disabled = false;
    next.textContent = '直接全部揭曉';
    all.hidden = true;
  } else {
    next.disabled = left > 0;
    next.textContent = left > 0 ? `抽籤中…（${Math.ceil(left / 1000)} 秒）` : info.br.published ? '🎰 重新開始直播抽籤' : '🎰 開始直播抽籤';
  }
}
