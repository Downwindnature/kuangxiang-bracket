// drawfx.js — 前台「抽籤球」動畫：抽獎球裡一堆球滾動 → 跑出兩顆球（抽到一起的兩隊）→ 停留 → 飛進賽程表
// 時間軸以伺服器時間（看板的 draw.at）為準，所以中途打開或重新整理前台也會接在正確的位置。
import { drawTiming } from './banner.js?v=f641a603';
import { Drum, BALL_COLORS, MAX_DRUM_BALLS } from './drum.js?v=f641a603';
import { FONT_STACK } from './util.js?v=f641a603';

// 版面（舞台 1920×1080 座標）；前台的預設位置，後台抽籤球畫面會傳入自己的 geom
const DEFAULT_GEOM = {
  cx: 960, cy: 668,                                   // 抽獎球圓心
  scale: 1,                                           // 抽獎球大小
  slots: [{ x: 530, y: 640 }, { x: 1390, y: 640 }],   // 抽出來的兩顆球停留的位置（中間是 VS）
  titleTop: 204,                                      // 「第 n 組」標題
  backTop: 196,                                       // 暗色背景從哪裡開始（上面留給看板）
};
const R_OUT = 250, R_IN = 238;     // 外框半徑、球能滾動的內側半徑（抽獎球本身的座標）
const CAN = { w: 700, h: 780, ox: 350, oy: 400 }; // 畫布大小、圓心在畫布裡的位置
const BIG = 175;                   // 抽出來的球放大後的半徑
const STEP = 1 / 240;
const LAG = 0.16;                  // 第二顆球晚一點出來
const A_END = 0.28, B_END = 0.4, C_END = 0.94; // 出口動畫各段（秒，相對每顆球）

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t) => { const c = 1.6; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const bez = (p0, p1, p2, t) => ({
  x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
  y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
});
const normAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function intensity(t, tm) {
  if (t >= tm.tumble) return Math.max(0, 0.5 * (1 - (t - tm.tumble) / 0.35));
  const up = smooth(0.12, 0.55, t);
  const down = 1 - 0.5 * smooth(tm.tumble - 0.35, tm.tumble, t);
  return up * down;
}

// persistent：後台抽籤球畫面用，沒有在抽的時候也顯示抽獎球（用 setIdle 設定球數）
export function createDrawFx(stage, opts = {}) {
  const { now, board, onFrame, persistent = false, backdrop = true } = opts;
  const G = Object.assign({}, DEFAULT_GEOM, opts.geom || {});
  const K = G.scale;
  const CX = G.cx, CY = G.cy;
  const SLOT = G.slots;
  const VS = { x: (SLOT[0].x + SLOT[1].x) / 2, y: (SLOT[0].y + SLOT[1].y) / 2 };
  const OUTLET = { x: CX, y: CY - (R_IN - 6) * K };
  const TUBE_TOP = { x: CX, y: CY - (R_OUT + 72) * K };
  const root = document.createElement('div');
  root.className = 'dfx' + (persistent ? ' persistent' : '');
  root.hidden = !persistent;
  root.setAttribute('aria-hidden', 'true');
  const ballHtml = '<div class="dfx-ball"><div class="dfx-face"><div class="dfx-q">？</div><div class="dfx-name"></div></div></div>';
  root.innerHTML = `<div class="dfx-back"></div>
    <div class="dfx-title"><div class="dfx-n"></div><div class="dfx-sub">抽籤中<i>.</i><i>.</i><i>.</i></div></div>
    <canvas class="dfx-drum"></canvas>
    <div class="dfx-burst"></div>
    <div class="dfx-vs">VS</div>${ballHtml}${ballHtml}`;
  const adminBtn = stage.querySelector('.admin-btn');
  stage.insertBefore(root, adminBtn || null);
  const $ = (s) => root.querySelector(s);
  const back = $('.dfx-back'), title = $('.dfx-title'), titleN = $('.dfx-n'), sub = $('.dfx-sub');
  const canvas = $('.dfx-drum'), burst = $('.dfx-burst'), vs = $('.dfx-vs');
  const balls = [...root.querySelectorAll('.dfx-ball')].map((el) => ({ el, q: el.querySelector('.dfx-q'), name: el.querySelector('.dfx-name') }));
  const ctx = canvas.getContext('2d');
  // 依版面放好各個元素
  canvas.style.left = `${CX - CAN.ox}px`;
  canvas.style.top = `${CY - CAN.oy}px`;
  burst.style.left = `${CX}px`;
  burst.style.top = `${TUBE_TOP.y}px`;
  vs.style.left = `${VS.x}px`;
  vs.style.top = `${VS.y}px`;
  title.style.top = `${G.titleTop}px`;
  title.style.left = `${CX - 600}px`;
  title.style.right = 'auto';
  title.style.width = '1200px';
  back.style.top = `${G.backTop}px`;
  if (!backdrop) back.style.display = 'none';
  let cur = null;
  let layers = null; // 預先畫好的球體背面、正面、球的貼圖
  let idleDrum = null; // 後台：沒有在抽的時候顯示的球
  let idleWant = null;
  let idlePainted = false;

  const stageScale = () => {
    const r = stage.getBoundingClientRect();
    return r.width / 1920 || 1;
  };

  function buildLayers(r) {
    const k = Math.max(0.5, Math.min(3, stageScale() * (window.devicePixelRatio || 1)));
    canvas.width = Math.round(CAN.w * k);
    canvas.height = Math.round(CAN.h * k);
    const mk = (w, h) => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      const g = c.getContext('2d');
      g.setTransform(k, 0, 0, k, 0, 0);
      return [c, g];
    };
    const { ox, oy } = CAN;
    // 背面：底座、玻璃球體
    const [bk, b] = mk(CAN.w, CAN.h);
    const glow = b.createRadialGradient(ox, oy, R_OUT * 0.3, ox, oy, R_OUT + 90);
    glow.addColorStop(0, 'rgba(150, 90, 255, .30)');
    glow.addColorStop(0.7, 'rgba(90, 60, 230, .14)');
    glow.addColorStop(1, 'rgba(60, 40, 200, 0)');
    b.fillStyle = glow;
    b.fillRect(0, 0, CAN.w, CAN.h);
    // 底座
    const by = oy + R_OUT - 34;
    b.beginPath();
    b.moveTo(ox - 96, by);
    b.lineTo(ox + 96, by);
    b.lineTo(ox + 176, oy + R_OUT + 96);
    b.lineTo(ox - 176, oy + R_OUT + 96);
    b.closePath();
    const sg = b.createLinearGradient(0, by, 0, oy + R_OUT + 96);
    sg.addColorStop(0, '#3a2490');
    sg.addColorStop(1, '#140a46');
    b.fillStyle = sg;
    b.fill();
    b.lineWidth = 3;
    b.strokeStyle = 'rgba(110, 210, 255, .95)';
    b.shadowColor = 'rgba(80, 190, 255, .9)';
    b.shadowBlur = 16;
    b.stroke();
    b.shadowBlur = 0;
    b.fillStyle = 'rgba(120, 220, 255, .75)';
    b.fillRect(ox - 150, oy + R_OUT + 78, 300, 4);
    // 玻璃球體（內部）
    const gg = b.createRadialGradient(ox - 60, oy - 70, 20, ox, oy, R_OUT);
    gg.addColorStop(0, 'rgba(190, 220, 255, .16)');
    gg.addColorStop(0.7, 'rgba(110, 90, 240, .16)');
    gg.addColorStop(1, 'rgba(70, 40, 190, .42)');
    b.beginPath();
    b.arc(ox, oy, R_OUT, 0, Math.PI * 2);
    b.fillStyle = gg;
    b.fill();
    b.lineWidth = 3;
    b.strokeStyle = 'rgba(255, 255, 255, .06)';
    b.beginPath();
    b.ellipse(ox, oy, R_OUT - 4, (R_OUT - 4) * 0.3, 0, 0, Math.PI * 2);
    b.stroke();
    b.beginPath();
    b.ellipse(ox, oy, (R_OUT - 4) * 0.34, R_OUT - 4, 0, 0, Math.PI * 2);
    b.stroke();

    // 正面：外框、反光、頂部出口管
    const [fr, f] = mk(CAN.w, CAN.h);
    const rg = f.createLinearGradient(ox - R_OUT, oy - R_OUT, ox + R_OUT, oy + R_OUT);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.35, '#8fe3ff');
    rg.addColorStop(0.7, '#9b6bff');
    rg.addColorStop(1, '#5a3be0');
    f.lineWidth = 8;
    f.strokeStyle = rg;
    f.shadowColor = 'rgba(120, 200, 255, .9)';
    f.shadowBlur = 26;
    f.beginPath();
    f.arc(ox, oy, R_OUT, 0, Math.PI * 2);
    f.stroke();
    f.shadowBlur = 0;
    f.lineCap = 'round';
    f.lineWidth = 16;
    f.strokeStyle = 'rgba(255, 255, 255, .26)';
    f.beginPath();
    f.arc(ox, oy, R_OUT - 24, Math.PI * 1.08, Math.PI * 1.38);
    f.stroke();
    f.lineWidth = 7;
    f.strokeStyle = 'rgba(255, 255, 255, .14)';
    f.beginPath();
    f.arc(ox, oy, R_OUT - 26, Math.PI * 0.12, Math.PI * 0.3);
    f.stroke();
    f.fillStyle = 'rgba(255, 255, 255, .7)';
    f.beginPath();
    f.arc(ox - R_OUT * 0.5, oy - R_OUT * 0.62, 7, 0, Math.PI * 2);
    f.fill();
    // 出口管
    const tw = Math.max(2 * r + 18, 54);
    const ty0 = oy - R_OUT - 72, ty1 = oy - R_OUT + 14;
    const tg = f.createLinearGradient(ox - tw / 2, 0, ox + tw / 2, 0);
    tg.addColorStop(0, 'rgba(160, 220, 255, .38)');
    tg.addColorStop(0.5, 'rgba(160, 220, 255, .08)');
    tg.addColorStop(1, 'rgba(160, 220, 255, .30)');
    f.fillStyle = tg;
    f.fillRect(ox - tw / 2, ty0, tw, ty1 - ty0);
    f.lineWidth = 3;
    f.strokeStyle = 'rgba(140, 220, 255, .95)';
    f.shadowColor = 'rgba(80, 190, 255, .9)';
    f.shadowBlur = 12;
    f.beginPath();
    f.moveTo(ox - tw / 2, ty1);
    f.lineTo(ox - tw / 2, ty0);
    f.moveTo(ox + tw / 2, ty0);
    f.lineTo(ox + tw / 2, ty1);
    f.stroke();
    f.fillStyle = '#b8a4ff';
    f.fillRect(ox - tw / 2 - 8, ty0 - 8, tw + 16, 10);
    f.shadowBlur = 0;

    // 球的貼圖（每種顏色一張）
    const sprites = BALL_COLORS.map((c) => {
      const s = r * 2 + 6;
      const [sp, g] = mk(s, s);
      const cx = s / 2, cy = s / 2;
      const grad = g.createRadialGradient(cx - r * 0.35, cy - r * 0.42, r * 0.08, cx, cy, r);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.18, c.c1);
      grad.addColorStop(0.55, c.c2);
      grad.addColorStop(1, c.c3);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      const fg = g.createRadialGradient(cx - r * 0.12, cy - r * 0.15, 1, cx, cy, r * 0.64);
      fg.addColorStop(0, '#ffffff');
      fg.addColorStop(1, '#ddd6f6');
      g.fillStyle = fg;
      g.beginPath();
      g.arc(cx, cy, r * 0.64, 0, Math.PI * 2);
      g.fill();
      return sp;
    });
    layers = { k, r, back: bk, front: fr, sprites };
  }

  function drawDrum(drum, I, t) {
    const k = layers.k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(layers.back, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (I > 0.02) { // 底部吹氣的光
      const pulse = 0.75 + 0.25 * Math.sin(t * 18);
      const jg = ctx.createRadialGradient(CAN.ox, CAN.oy + R_IN * 0.92, 10, CAN.ox, CAN.oy + R_IN * 0.8, 190);
      jg.addColorStop(0, `rgba(120, 230, 255, ${0.42 * I * pulse})`);
      jg.addColorStop(1, 'rgba(120, 230, 255, 0)');
      ctx.fillStyle = jg;
      ctx.beginPath();
      ctx.arc(CAN.ox, CAN.oy, R_IN, 0, Math.PI * 2);
      ctx.fill();
    }
    const r = drum.r;
    const half = (r * 2 + 6) / 2;
    ctx.font = `900 ${Math.round(r * 0.78)}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#2a1866';
    for (const b of drum.balls) {
      if (b.out) continue;
      const x = CAN.ox + b.x, y = CAN.oy + b.y;
      ctx.drawImage(layers.sprites[b.color], x - half, y - half, half * 2, half * 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.a);
      ctx.fillText('?', 0, r * 0.04);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layers.front, 0, 0);
  }

  function setBallStyle(i, colorIdx) {
    const c = BALL_COLORS[colorIdx % BALL_COLORS.length];
    const s = balls[i].el.style;
    s.setProperty('--c1', c.c1);
    s.setProperty('--c2', c.c2);
    s.setProperty('--c3', c.c3);
    s.setProperty('--glow', c.glow);
  }

  // 名稱盡量一行放完（字太小才換行，最多三行）
  function fitName(el) {
    let size = 50;
    el.style.whiteSpace = 'nowrap';
    el.style.fontSize = size + 'px';
    while (el.scrollWidth > el.clientWidth + 1 && size > 30) { size -= 2; el.style.fontSize = size + 'px'; }
    if (el.scrollWidth <= el.clientWidth + 1) return;
    el.style.whiteSpace = 'normal';
    size = 46;
    el.style.fontSize = size + 'px';
    let guard = 0;
    while ((el.scrollHeight > 176 || el.scrollWidth > el.clientWidth + 1) && size > 18 && guard++ < 40) {
      size -= 2;
      el.style.fontSize = size + 'px';
    }
  }

  // 第 i 顆球離開抽獎球（輪到它的時候才從球堆裡挑離出口最近的一顆）
  function pickOne(i, t) {
    const b = cur.drum.pick(1)[0];
    const lateJoin = t > cur.tm.tumble + i * LAG + 0.05 || !b;
    cur.picked[i] = {
      from: b && !lateJoin ? { x: CX + b.x * K, y: CY + b.y * K } : { x: OUTLET.x, y: OUTLET.y },
      rot: normAngle(b ? b.a : 0) + (i ? Math.PI * 2 : -Math.PI * 2),
      color: b ? b.color : (i ? 7 : 4),
      r: cur.drum.r * K,
    };
    setBallStyle(i, cur.picked[i].color);
  }

  function slotTarget(leaf, i) {
    const el = board && leaf != null ? board.querySelector(`[data-leaf="${leaf}"]`) : null;
    if (!el) return { x: SLOT[i].x, y: SLOT[i].y, r: 0 };
    const sr = stage.getBoundingClientRect();
    const s = sr.width / 1920 || 1;
    const er = el.getBoundingClientRect();
    return {
      x: (er.left + er.width / 2 - sr.left) / s,
      y: (er.top + er.height / 2 - sr.top) / s,
      r: Math.max(10, (er.height / s) * 0.62),
    };
  }

  function placeBall(i, t) {
    const { tm } = cur;
    const B = balls[i];
    const pi = cur.picked[i];
    const st = B.el.style;
    if (!pi) { st.opacity = '0'; return; }
    const holdEnd = tm.revealAt - tm.fly;
    let x, y, r, rot = 0, op = 1, nameOp = 1;
    const e = Math.max(0, t - tm.tumble - i * LAG);
    if (t < holdEnd) {
      if (e < C_END) {
        const prog = easeOut(clamp01(e / C_END));
        rot = pi.rot * (1 - prog);
        if (e < A_END) {
          const u = easeInOut(e / A_END);
          x = lerp(pi.from.x, OUTLET.x, u); y = lerp(pi.from.y, OUTLET.y, u); r = pi.r; nameOp = 0;
        } else if (e < B_END) {
          const u = (e - A_END) / (B_END - A_END);
          x = OUTLET.x; y = lerp(OUTLET.y, TUBE_TOP.y, u); r = pi.r; nameOp = 0;
        } else {
          const u = (e - B_END) / (C_END - B_END);
          const ctl = { x: lerp(CX, SLOT[i].x, 0.77), y: TUBE_TOP.y - 40 };
          const q = bez(TUBE_TOP, ctl, SLOT[i], easeInOut(u));
          x = q.x; y = q.y;
          const g = easeInOut(clamp01((u - 0.1) / 0.9)); // 先飛出來、後半段才放大，最後彈一下
          r = lerp(pi.r, BIG, g) * (1 + 0.07 * Math.sin(Math.PI * clamp01((u - 0.72) / 0.28)));
          nameOp = smooth(0.5, 0.95, u);
        }
      } else {
        const bob = Math.sin((t - tm.tumble) * 2.4 + i * 1.7) * 6;
        x = SLOT[i].x; y = SLOT[i].y + bob; r = BIG;
      }
    } else if (t < tm.revealAt) {
      if (!cur.targets) {
        const leaves = cur.d.leaves || [];
        cur.targets = [slotTarget(leaves[0], 0), slotTarget(leaves[1], 1)];
      }
      const g = cur.targets[i];
      const u = clamp01((t - holdEnd) / tm.fly);
      const from = { x: SLOT[i].x, y: SLOT[i].y };
      const ctl = { x: lerp(from.x, g.x, 0.5), y: Math.min(from.y, g.y) - 140 };
      const q = bez(from, ctl, g, easeInOut(u));
      x = q.x; y = q.y;
      r = lerp(BIG, g.r, easeInOut(u));
      op = 1 - smooth(0.7, 1, u);
    } else {
      st.opacity = '0';
      return;
    }
    st.opacity = String(op);
    st.transform = `translate(${(x - BIG).toFixed(1)}px, ${(y - BIG).toFixed(1)}px) scale(${(r / BIG).toFixed(4)}) rotate(${rot.toFixed(3)}rad)`;
    B.name.style.opacity = String(nameOp);
    B.q.style.opacity = String(1 - nameOp);
  }

  function frame() {
    if (!cur) return;
    const { tm } = cur;
    const t = Math.max(0, (now() - cur.d.at) / 1000);
    if (t >= tm.end) { finish(); if (onFrame) onFrame(); return; }
    const pn = performance.now();
    cur.acc += Math.min(0.05, (pn - cur.last) / 1000);
    cur.last = pn;
    const I = intensity(t, tm);
    let guard = 0;
    while (cur.acc >= STEP && guard++ < 16) { cur.drum.step(STEP, I); cur.acc -= STEP; }
    if (guard >= 16) cur.acc = 0;
    for (let i = 0; i < 2; i++) if (!cur.picked[i] && t >= tm.tumble + i * LAG) pickOne(i, t);

    const holdEnd = tm.revealAt - tm.fly;
    // 背景、標題
    root.style.opacity = persistent ? '1' : String(smooth(0, 0.3, t));
    back.style.opacity = String(1 - smooth(holdEnd, tm.revealAt, t));
    title.style.opacity = String(Math.min(persistent ? smooth(0, 0.3, t) : 1, 1 - smooth(holdEnd, holdEnd + 0.3, t)));
    sub.style.opacity = String(1 - smooth(tm.tumble - 0.1, tm.tumble + 0.2, t));
    // 抽獎球：抽出來的球放大時先淡出，後台抽籤球畫面在球飛走時再淡入
    const exitFade = smooth(tm.tumble + 0.3, tm.tumble + tm.exit, t);
    let op = 0, sc = 0.88;
    if (exitFade < 1) {
      const intro = persistent ? 1 : easeOutBack(clamp01(t / 0.45));
      op = (persistent ? 1 : clamp01(t / 0.25)) * (1 - exitFade);
      sc = lerp(0.55, 1, Math.min(1.05, intro)) * (1 - 0.12 * exitFade);
    } else if (persistent) {
      const back2 = smooth(holdEnd, tm.revealAt, t);
      op = back2;
      sc = lerp(0.88, 1, back2);
    }
    if (op > 0.001) {
      canvas.style.opacity = String(op);
      canvas.style.transform = `scale(${(sc * K).toFixed(4)})`;
      drawDrum(cur.drum, I, t);
    } else if (canvas.style.opacity !== '0') {
      canvas.style.opacity = '0';
    }
    // 出口的閃光
    const e0 = t - tm.tumble, e1 = e0 - LAG;
    const fl = (e) => (e > B_END - 0.06 && e < B_END + 0.32 ? Math.sin(Math.PI * clamp01((e - (B_END - 0.06)) / 0.38)) : 0);
    const bf = Math.max(fl(e0), fl(e1));
    burst.style.opacity = String(bf);
    burst.style.transform = `translate(-50%, -50%) scale(${((0.4 + bf * 1.1) * K).toFixed(3)})`;
    // VS
    const vsIn = clamp01((t - (tm.tumble + tm.exit - 0.2)) / 0.4);
    const vsOut = smooth(holdEnd, holdEnd + 0.3, t);
    vs.style.opacity = String(Math.min(1, vsIn * 1.4) * (1 - vsOut));
    vs.style.transform = `translate(-50%, -50%) scale(${(vsIn < 1 ? lerp(2.4, 1, easeOutBack(vsIn)) : 1).toFixed(3)})`;
    placeBall(0, t);
    placeBall(1, t);
    if (onFrame) onFrame();
    cur.raf = requestAnimationFrame(frame);
  }

  const liveCount = (drum) => (drum ? drum.balls.filter((b) => !b.out).length : -1);
  function settledDrum(n) {
    const d = new Drum({ R: R_IN, count: n, settled: true });
    for (let i = 0; i < 360; i++) d.step(STEP, 0);
    return d;
  }

  // 後台：沒有在抽的時候，畫一張靜止的抽獎球（球都停在底部）
  function paintIdle() {
    if (!persistent || cur) return;
    const n = idleWant == null ? Math.max(0, liveCount(idleDrum)) : idleWant;
    if (liveCount(idleDrum) !== n) idleDrum = settledDrum(n);
    if (!layers || layers.r !== idleDrum.r || Math.abs(layers.k - stageScale() * (window.devicePixelRatio || 1)) > 0.05) buildLayers(idleDrum.r);
    root.hidden = false;
    root.style.opacity = '1';
    for (const el of [title, vs, burst]) el.style.opacity = '0';
    balls.forEach((B) => { B.el.style.opacity = '0'; });
    canvas.style.opacity = '1';
    canvas.style.transform = `scale(${K})`;
    drawDrum(idleDrum, 0, 0);
    idlePainted = true;
  }

  function start(d, t, id) {
    if (cur) stop();
    const tm = drawTiming(d);
    const pool = Math.max(2, Math.min(MAX_DRUM_BALLS, Math.round(Number(d.pool)) || 12));
    let drum;
    if (persistent && t < 0.3 && liveCount(idleDrum) === pool) drum = idleDrum; // 接著畫面上那些球開始滾
    else {
      drum = new Drum({ R: R_IN, count: pool, settled: t < 0.3 });
      if (t >= 0.3 && t < tm.tumble) { // 中途打開：先讓球亂飛一下
        for (let i = 0; i < 240; i++) drum.step(STEP, 1);
      }
    }
    cur = { id, d, tm, drum, picked: [null, null], targets: null, acc: 0, last: performance.now(), raf: 0 };
    idlePainted = false;
    if (!layers || layers.r !== drum.r || Math.abs(layers.k - stageScale() * (window.devicePixelRatio || 1)) > 0.05) buildLayers(drum.r);
    titleN.textContent = `第 ${d.n || ''} 組`;
    const names = d.names || [];
    balls.forEach((B, i) => {
      B.name.textContent = names[i] || '未命名隊伍';
      B.el.style.opacity = '0';
    });
    root.hidden = false;
    root.style.opacity = persistent ? '1' : '0';
    balls.forEach((B) => fitName(B.name));
    frame();
  }

  // 動畫播完
  function finish() {
    if (!cur) return;
    cancelAnimationFrame(cur.raf);
    const drum = cur.drum;
    cur = null;
    if (persistent) { idleDrum = drum; paintIdle(); } else root.hidden = true;
  }

  // 中途停止（看板換成別的內容）
  function stop() {
    if (!cur) return;
    cancelAnimationFrame(cur.raf);
    cur = null;
    if (persistent) paintIdle(); else root.hidden = true;
  }

  return {
    // 依看板內容啟動／結束動畫（重複呼叫沒關係）
    sync(banner) {
      const d = banner && banner.mode === 'draw' ? banner.draw : null;
      const ok = !!(d && d.kind === 'pair' && d.fx && d.at);
      const t = ok ? (now() - d.at) / 1000 : Infinity;
      if (!ok || t >= drawTiming(d).end || t < -5) { stop(); return; }
      const id = `${d.at}|${d.n}`;
      if (cur && cur.id === id) return;
      start(d, Math.max(0, t), id);
    },
    // 後台：抽獎球裡要顯示幾顆球（還沒抽出的隊伍數）
    setIdle(pool) {
      if (!persistent) return;
      const n = Math.max(0, Math.min(MAX_DRUM_BALLS, Math.round(Number(pool) || 0)));
      if (n === idleWant && idlePainted) return;
      idleWant = n;
      if (!cur) paintIdle();
    },
    // 視窗大小改變：重畫（畫布解析度跟著變）
    repaint() {
      if (cur) { buildLayers(cur.drum.r); return; }
      layers = null;
      idlePainted = false;
      paintIdle();
    },
    active: () => !!cur,
    stop,
    destroy() {
      if (cur) cancelAnimationFrame(cur.raf);
      cur = null;
      root.remove();
    },
  };
}

// 前台賽程在動畫結束前先把這一組遮住（避免名字比球先出現）
export function drawMask(banner, nowMs) {
  const d = banner && banner.mode === 'draw' ? banner.draw : null;
  if (!d || d.kind !== 'pair' || !d.fx || !d.at || !Array.isArray(d.leaves)) return null;
  const t = (nowMs - d.at) / 1000;
  return t < drawTiming(d).revealAt ? d.leaves : null;
}
