// drum.js — 抽籤球在抽獎球（透明圓球）裡滾動的物理模擬（純計算，不碰畫面；座標以圓心為原點，y 向下）
export const BALL_COLORS = [
  { c1: '#ffd0e0', c2: '#ff4f86', c3: '#9c0f43', glow: 'rgba(255, 80, 140, .85)' },
  { c1: '#ffe9b8', c2: '#ffad33', c3: '#a85a00', glow: 'rgba(255, 170, 50, .85)' },
  { c1: '#fff6c2', c2: '#ffd83d', c3: '#a07d00', glow: 'rgba(255, 220, 70, .85)' },
  { c1: '#cfffe4', c2: '#36e88a', c3: '#0b7a41', glow: 'rgba(60, 235, 140, .8)' },
  { c1: '#d2f6ff', c2: '#33cfff', c3: '#05638f', glow: 'rgba(60, 200, 255, .85)' },
  { c1: '#d9e0ff', c2: '#5272ff', c3: '#1a2a9e', glow: 'rgba(90, 120, 255, .85)' },
  { c1: '#ecdcff', c2: '#a35cff', c3: '#4b1a9e', glow: 'rgba(170, 100, 255, .85)' },
  { c1: '#ffd9fb', c2: '#ff5ced', c3: '#93107f', glow: 'rgba(255, 100, 235, .85)' },
];

export const MAX_DRUM_BALLS = 40;

// 球越多、球越小，讓抽獎球裡看起來差不多滿
export function ballRadius(count) {
  if (count <= 12) return 30;
  if (count >= MAX_DRUM_BALLS) return 18;
  return 30 - ((count - 12) * 12) / (MAX_DRUM_BALLS - 12);
}

export class Drum {
  // R：抽獎球內側半徑；settled：一開始球都堆在底部（剛開始抽）或已經在空中亂飛（中途才打開畫面）
  constructor({ R = 238, count = 12, rng = Math.random, settled = true } = {}) {
    this.R = R;
    this.rng = rng;
    this.r = ballRadius(count);
    this.t = 0;
    this.balls = [];
    const n = Math.max(0, Math.min(MAX_DRUM_BALLS, count));
    const lim = R - this.r - 1;
    const offset = Math.floor(rng() * BALL_COLORS.length);
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 300; tries++) {
        const a = rng() * Math.PI * 2;
        const d = Math.sqrt(rng()) * lim;
        x = Math.cos(a) * d;
        y = Math.sin(a) * d;
        if (settled && y < lim * 0.1) y = Math.abs(y) + lim * 0.1; // 堆在下半部
        if (x * x + y * y > lim * lim) continue;
        if (this.balls.every((b) => (b.x - x) ** 2 + (b.y - y) ** 2 >= (2 * this.r) ** 2)) break;
      }
      const sp = settled ? 0 : 500 + rng() * 700;
      const va = rng() * Math.PI * 2;
      this.balls.push({
        x, y,
        vx: Math.cos(va) * sp, vy: Math.sin(va) * sp,
        a: rng() * Math.PI * 2,
        color: (offset + i) % BALL_COLORS.length,
        gx: 0, gy: 1, gUntil: 0,
        out: false,
      });
    }
  }

  // 每一小步（建議 dt = 1/240 秒）；intensity 0 ~ 1：吹氣強度
  step(dt, intensity = 1) {
    const { R, r, rng } = this;
    const I = Math.max(0, Math.min(1, intensity));
    const G = 2200;
    const lim = R - r;
    this.t += dt;
    const live = this.balls.filter((b) => !b.out);
    for (const b of live) {
      if (this.t >= b.gUntil) { // 每顆球的「陣風」隔一小段時間換一次，球才會亂飛
        const a = (rng() - 0.5) * 1.4;
        b.gx = Math.sin(a);
        b.gy = 0.6 + rng() * 0.8;
        b.gUntil = this.t + 0.12 + rng() * 0.2;
      }
      let ax = 0, ay = G;
      if (I > 0) {
        const low = b.y / R; // -1（頂部）~ 1（底部）
        const jet = Math.max(0, Math.min(1, (low - 0.15) / 0.55)); // 底部吹氣
        ay -= I * jet * 9000 * b.gy;
        ax += I * jet * 5200 * b.gx;
        const d = Math.hypot(b.x, b.y) || 1; // 旋轉氣流
        ax += I * 1100 * (-b.y / d);
        ay += I * 1100 * (b.x / d);
        ax += I * 900 * b.gx; // 整體亂流
      }
      b.vx += ax * dt;
      b.vy += ay * dt;
      const damp = Math.exp(-(I > 0 ? 0.45 : 1.6) * dt);
      b.vx *= damp;
      b.vy *= damp;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 2600) { b.vx *= 2600 / sp; b.vy *= 2600 / sp; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.a += (b.vx * dt) / r;
    }
    // 球與球碰撞
    const e = 0.9, min = 2 * r;
    for (let i = 0; i < live.length; i++) {
      const p = live[i];
      for (let j = i + 1; j < live.length; j++) {
        const q = live[j];
        const dx = q.x - p.x, dy = q.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const nx = d2 ? dx / d : 1, ny = d2 ? dy / d : 0;
        const o = (min - d) / 2;
        p.x -= nx * o; p.y -= ny * o;
        q.x += nx * o; q.y += ny * o;
        const vr = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
        if (vr < 0) {
          const J = (-(1 + e) * vr) / 2;
          p.vx -= J * nx; p.vy -= J * ny;
          q.vx += J * nx; q.vy += J * ny;
        }
      }
    }
    // 撞到球壁
    for (const b of live) {
      const d = Math.hypot(b.x, b.y);
      if (d <= lim) continue;
      const nx = b.x / d, ny = b.y / d;
      b.x = nx * lim;
      b.y = ny * lim;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= 1.82 * vn * nx;
        b.vy -= 1.82 * vn * ny;
      }
      b.vx *= 0.985;
      b.vy *= 0.985;
    }
  }

  // 被抽出來的球：離出口（頂部）最近的幾顆
  pick(k = 2) {
    const live = this.balls.filter((b) => !b.out);
    live.sort((a, b) => Math.hypot(a.x, a.y + this.R) - Math.hypot(b.x, b.y + this.R));
    const out = live.slice(0, k);
    out.forEach((b) => { b.out = true; });
    return out;
  }
}
