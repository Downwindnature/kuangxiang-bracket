// bg.js — 星空背景（靜態星點 + 少量閃爍）
export function startStars(canvas, { density = 1 } = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let stars = [];
  let w = 0, h = 0, dpr = 1;
  const rand = (a, b) => a + Math.random() * (b - a);

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const count = Math.round((w * h) / 4200 * density);
    stars = [];
    for (let i = 0; i < count; i++) {
      const big = Math.random() < 0.05;
      stars.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.78,
        r: big ? rand(1.2, 2.2) : rand(0.3, 1.1),
        a: rand(0.35, 1),
        tw: Math.random() < 0.18 ? rand(0.6, 2.2) : 0,
        ph: Math.random() * Math.PI * 2,
        sparkle: big && Math.random() < 0.5,
        hue: Math.random() < 0.2 ? 270 : Math.random() < 0.5 ? 220 : 0,
      });
    }
  }

  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      let a = s.a;
      if (s.tw) a *= 0.55 + 0.45 * Math.sin(t / 1000 * s.tw + s.ph);
      const color = s.hue ? `hsla(${s.hue}, 90%, 85%, ${a})` : `rgba(255,255,255,${a})`;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.sparkle) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 4, s.y); ctx.lineTo(s.x + s.r * 4, s.y);
        ctx.moveTo(s.x, s.y - s.r * 4); ctx.lineTo(s.x, s.y + s.r * 4);
        ctx.stroke();
      }
    }
  }

  let last = 0;
  function loop(t) {
    if (t - last > 66) { draw(t); last = t; } // 約 15fps 就夠，省電
    requestAnimationFrame(loop);
  }
  build();
  draw(0);
  window.addEventListener('resize', () => { build(); draw(performance.now()); });
  if (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches) requestAnimationFrame(loop);
}
