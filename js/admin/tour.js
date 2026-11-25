// admin/tour.js — 使用教學：一步一步帶你看過後台
// 第一次進後台會自動開始；左邊選單的「使用教學」可以從頭再看，每頁標題旁的「？這頁怎麼用」只看那一頁。
// 教學只會換頁、切換分頁標籤、捲動畫面，不會按任何會改資料的按鈕。
import { toast } from './ui.js?v=2628f905';

const DONE_KEY = 'kxb-tour-done';
const VERSION = '1';

// page：要在哪一頁（home = 首頁）；tab：顯示屏設定的分頁；target：要框起來的地方（陣列 = 依序找第一個有的）
export const STEPS = [
  { chapter: 'start', page: 'home', title: '歡迎使用狂想之息賽程表後台 👋',
    body: '這個教學會一步一步帶你看過後台的每個功能，大約 2 分鐘。<br>可以用鍵盤 <kbd>←</kbd> <kbd>→</kbd> 切換，隨時按「跳過教學」離開；之後在左邊選單按「📖 使用教學」可以再看一次。',
    next: '開始教學 →' },
  { chapter: 'start', page: 'home', target: '#side .nav-main', place: 'right', title: '功能選單',
    body: '左邊是功能選單，比賽前依序用「<b>表單匯入</b> → <b>選手抽籤</b>」，比賽當天用「<b>顯示屏設定</b>」。<br>每個按鈕下面的小字會顯示目前的進度。' },
  { chapter: 'start', page: 'home', target: '#tourBtn', place: 'right', title: '隨時可以再看教學',
    body: '忘記怎麼用的時候按這裡，就會從頭再帶你走一次。每一頁標題旁邊也有「？ 這頁怎麼用」，只看那一頁的說明。' },
  { chapter: 'start', page: 'home', target: '.home-steps', place: 'top', title: '整體進度',
    body: '首頁下面是整個比賽的進度：<b>匯入報名 → 組隊媒合 → 賽程抽籤 → 公布賽程 → 比賽</b>。<br>還沒完成的那一步會標示「下一步」，點一下就會帶你過去。' },

  { chapter: 'import', page: 'import', target: '#impStats', title: '① 表單匯入｜報名統計',
    body: '匯入報名資料後，這裡會自動算出 3 人／2 人／1 人報名各幾組、可以組成幾隊，以及<b>需要確認</b>的資料（缺遊戲 ID、ID 重複報名…）。' },
  { chapter: 'import', page: 'import', target: ['#gsync', '#impSrc'], title: '從 Google 表單同步',
    body: '按「<b>從 Google 表單同步</b>」就會抓報名表最新的回覆。<br>第一次使用要先按旁邊的「同步設定」，貼上 Apps Script 的網址與金鑰（README 有步驟）。' },
  { chapter: 'import', page: 'import', target: ['#drop', '#impSrc'], title: '也可以匯入 Excel／CSV',
    body: '把 Google 表單下載的 Excel、SurveyCake 匯出的檔案，或自己整理的表格拖進這個框就能匯入；也可以「手動新增報名」或「匯出 CSV 備份」。' },
  { chapter: 'import', page: 'import', target: '#impList', place: 'top', title: '完整報名資料',
    body: '所有報名都在這裡：可以搜尋、篩選「需要確認」。<b>點任何一筆</b>可以修改資料，或設成「不列入」（例如重複報名）。' },

  { chapter: 'draw', page: 'draw', target: '#s1', title: '② 選手抽籤｜組隊媒合',
    body: '按「隨機媒合組隊」：3 人報名直接成隊，2 人、1 人報名的選手會自動媒合成 3 人一隊。<br>點一位選手再點另一位可以<b>交換</b>；★ 是隊長。' },
  { chapter: 'draw', page: 'draw', target: '#s2', title: '賽程抽籤',
    body: '選好輪空方式後按「<b>抽籤</b>」，賽程表就排好了（這時前台還看不到）。點兩隊可以交換位置，例如指定由哪一隊輪空。' },
  { chapter: 'draw', page: 'draw', target: '#s3', title: '公布到顯示屏',
    body: '「<b>一次公布全部</b>」直接公布賽程；「<b>直播抽籤</b>」會切換成全螢幕的抽籤球畫面，一組一組抽給大家看，前台同步播放動畫。' },

  { chapter: 'players', page: 'players', target: '#plList', place: 'top', title: '選手列表',
    body: '所有選手的遊戲暱稱、遊戲 ID、Discord 和目前的隊伍都列在這裡。可以搜尋、篩選「還沒進隊伍」「需要確認」，也可以匯出 CSV；點任何一位選手可以修改那筆報名資料。' },

  { chapter: 'display', page: 'display', tab: 'banner', target: '#bnPreview', title: '③ 顯示屏設定｜看板預覽',
    body: '這是前台最上面那塊看板現在的樣子。下面可以切換「<b>一般</b>」或「<b>跑馬燈</b>」樣式，一切換前台就會跟著變。' },
  { chapter: 'display', page: 'display', tab: 'banner', target: '#bnFlow', title: '比賽當天主要在這裡操作',
    body: '選目前場次 →「<b>開始這場</b>」→ 打完按「<b>結束本場、登錄比分</b>」→「<b>開始下一場</b>」。<br>前台會自動顯示 VS、正在比賽中、下一場請準備和勝負公告。' },
  { chapter: 'display', page: 'display', tab: 'banner', target: '#bnCustomCard', title: '臨時公告',
    body: '有事情要通知大家（例如：比賽延後 10 分鐘），寫在這裡按「發布公告」，取消後會回到原本的對戰畫面。' },
  { chapter: 'display', page: 'display', tab: 'banner', target: '#bnExtra', title: '額外顯示句子',
    body: '例如「現在時間：{日期} {星期} {時間}」，會即時更新。一般樣式顯示在看板右下角，跑馬燈則接在比賽訊息後面一起捲動。' },
  { chapter: 'display', page: 'display', tab: 'matches', target: ['#mList', '#tabBody .card'], title: '賽程與比分',
    body: '每場的時間、比分、勝方都可以在這裡改，也可以「自動排時間」（例如 21:00 開始、每場 30 分鐘）。' },
  { chapter: 'display', page: 'display', tab: 'look', target: '#lkStage', title: '顯示內容與外觀',
    body: '決定前台要顯示什麼：自動（有公布就顯示賽程表）、空白、參賽名單或賽程表。下面還有賽事標題（<b>留空 = 看板空白</b>）、隊名顯示方式、比分與時間等設定。' },
  { chapter: 'display', page: 'display', tab: 'banner', target: '#openFront', place: 'bottom', title: '打開前台',
    body: '按這裡開前台顯示屏。用 OBS 擷取時，網址後面加 <code>?obs=1</code> 可以隱藏「進入後台」按鈕和滑鼠游標。' },

  { chapter: 'reset', page: 'reset', target: '#rsReset', title: '④ 重置與還原',
    body: '比賽結束或要重新開始時，可以清空所有資料。按錯了可以按「<b>返回</b>」，或從下面的還原紀錄回到任何一個時間點（匯入、媒合、抽籤之前都會自動備份）。' },

  { chapter: 'end', page: 'home', title: '教學完成 🎉',
    body: '建議的流程：<b>表單匯入 → 選手抽籤 → 顯示屏設定</b>。<br>之後隨時可以按左邊的「📖 使用教學」再看一次，或按每頁標題旁的「？ 這頁怎麼用」。',
    next: '完成' },
];

export const CHAPTER_TEXT = { start: '開始', import: '表單匯入', draw: '選手抽籤', players: '選手列表', display: '顯示屏設定', reset: '重置', end: '完成' };

let T = null; // 目前的教學

export function tourDone() {
  try { return !!localStorage.getItem(DONE_KEY); } catch (e) { return true; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, VERSION); } catch (e) { /* 無痕模式等 */ }
}
export const tourActive = () => !!T;

// 第一次進後台：自動開始（全螢幕抽籤球畫面不打擾）
export function maybeAutoStart() {
  if (T || tourDone() || location.hash === '#drawball' || document.querySelector('.mask')) return;
  startTour(0);
}

// 只看某一頁的說明
export function startChapter(ch) {
  const from = STEPS.findIndex((s) => s.chapter === ch);
  if (from < 0) return;
  let to = from;
  while (to + 1 < STEPS.length && STEPS[to + 1].chapter === ch) to++;
  startTour(from, { to, chapterOnly: true });
}

export function startTour(from = 0, { to = STEPS.length - 1, chapterOnly = false } = {}) {
  endTour(false);
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = `
    <div class="tour-block"></div>
    <div class="tour-spot" hidden></div>
    <div class="tour-pop" role="dialog" aria-modal="true" aria-labelledby="tpTitle">
      <div class="tp-top"><span class="tp-chap"></span><span class="tp-count"></span></div>
      <h4 class="tp-title" id="tpTitle"></h4>
      <div class="tp-body"></div>
      <div class="tp-bar"><i></i></div>
      <div class="tp-foot">
        <button type="button" class="ghost tp-skip"></button>
        <span class="spacer"></span>
        <button type="button" class="tp-prev">← 上一步</button>
        <button type="button" class="primary tp-next"></button>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('touring');
  T = {
    root, from, to, chapterOnly, i: from, token: 0, el: null,
    spot: root.querySelector('.tour-spot'), pop: root.querySelector('.tour-pop'), raf: 0,
  };
  root.querySelector('.tp-next').onclick = () => next();
  root.querySelector('.tp-prev').onclick = () => prev();
  root.querySelector('.tp-skip').onclick = () => endTour(!T.chapterOnly, true);
  T.onKey = (e) => {
    if (e.key === 'Enter' && e.target.closest && e.target.closest('.tour-pop button')) return; // 交給按鈕自己處理
    if (e.key === 'Escape') { e.preventDefault(); endTour(!T.chapterOnly, true); } else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  };
  T.onMove = () => { cancelAnimationFrame(T.raf); T.raf = requestAnimationFrame(() => place()); };
  document.addEventListener('keydown', T.onKey, true);
  addEventListener('resize', T.onMove);
  addEventListener('scroll', T.onMove, { passive: true });
  go(from);
}

export function endTour(done = true, skipped = false) {
  if (!T) return;
  const t = T;
  T = null;
  cancelAnimationFrame(t.raf);
  document.removeEventListener('keydown', t.onKey, true);
  removeEventListener('resize', t.onMove);
  removeEventListener('scroll', t.onMove);
  t.root.remove();
  document.body.classList.remove('touring');
  if (done) markDone();
  if (skipped && done) toast('之後可以按左邊選單的「📖 使用教學」再看一次', { type: 'info', ms: 4500 });
}

function next() {
  if (!T) return;
  if (T.i >= T.to) { endTour(!T.chapterOnly); return; }
  go(T.i + 1);
}
function prev() {
  if (!T || T.i <= T.from) return;
  go(T.i - 1);
}

const visible = (el) => !!(el && el.isConnected && el.getClientRects().length);
function findTarget(target) {
  for (const sel of [].concat(target || [])) {
    const el = document.querySelector(sel);
    if (visible(el)) return el;
  }
  return null;
}
// 等畫面換好（換頁、切分頁都是馬上畫，但保險起見最多等 3 秒）
function waitFor(fn, ms = 3000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const loop = () => {
      const v = fn();
      if (v || performance.now() - t0 > ms) resolve(v || null);
      else requestAnimationFrame(loop);
    };
    loop();
  });
}

async function go(i) {
  const t = T;
  const step = STEPS[i];
  t.i = i;
  const token = ++t.token;
  t.root.classList.add('moving');
  // 換頁
  if (step.page) {
    const want = step.page === 'home' ? '' : step.page;
    const cur = (location.hash || '').replace(/^#/, '').replace(/^home$/, '');
    if (cur !== want) location.hash = want ? '#' + want : '#home';
    await waitFor(() => document.querySelector(`#side a[data-page="${step.page}"].on`) || (step.page === 'home' && document.querySelector('.home')));
  }
  // 顯示屏設定的分頁標籤
  if (step.tab) {
    const b = await waitFor(() => document.querySelector(`.tabs button[data-tab="${step.tab}"]`));
    if (b && !b.classList.contains('on')) b.click();
    await waitFor(() => document.querySelector(`.tabs button[data-tab="${step.tab}"].on`));
  }
  if (token !== t.token || T !== t) return;
  const el = step.target ? await waitFor(() => findTarget(step.target), 2500) : null;
  if (token !== t.token || T !== t) return;
  t.el = el;
  fill(step);
  if (el) scrollToEl(el, step);
  place();
  requestAnimationFrame(() => { if (T === t) t.root.classList.remove('moving'); });
  t.pop.querySelector('.tp-next').focus({ preventScroll: true });
}

function fill(step) {
  const t = T;
  const n = t.to - t.from + 1;
  const k = t.i - t.from + 1;
  t.pop.querySelector('.tp-chap').textContent = CHAPTER_TEXT[step.chapter] || '';
  t.pop.querySelector('.tp-count').textContent = `${k} / ${n}`;
  t.pop.querySelector('.tp-title').textContent = step.title;
  t.pop.querySelector('.tp-body').innerHTML = step.body;
  t.pop.querySelector('.tp-bar i').style.width = `${(k / n) * 100}%`;
  t.pop.querySelector('.tp-prev').hidden = t.i <= t.from;
  t.pop.querySelector('.tp-next').textContent = t.i >= t.to ? '完成' : (step.next || '下一步 →');
  t.pop.querySelector('.tp-skip').textContent = t.chapterOnly ? '關閉' : '跳過教學';
  t.pop.querySelector('.tp-skip').hidden = t.i >= t.to && !t.chapterOnly;
}

// 畫面上方固定住的東西（標題列、選手抽籤頁的 ①②③）有多高
function headH() {
  let h = 0;
  for (const sel of ['.top', '.jump']) {
    const el = document.querySelector(sel);
    if (!el || !el.getClientRects().length) continue;
    const b = el.getBoundingClientRect().bottom;
    if (b > h && b < innerHeight / 2) h = b;
  }
  return h;
}

// 捲到目標：寬的目標（卡片）連同下方（或上方）的教學卡片一起放進畫面；窄的目標（按鈕）放中間，教學卡片放旁邊
function scrollToEl(el, step) {
  if (el.closest('#side')) return; // 左邊選單固定在畫面上
  const r = el.getBoundingClientRect();
  const head = Math.max(0, headH());
  const avail = innerHeight - head;
  const mobile = innerWidth < 720;
  const ph = (T ? T.pop.offsetHeight : 200) + 14;
  const wide = mobile || r.width > innerWidth * 0.45 || step.place === 'top' || step.place === 'bottom';
  let top; // 目標的上緣要放在標題列下方幾 px
  if (wide && r.height + ph + 24 <= avail) {
    const pad = (avail - r.height - ph) / 2;
    top = step.place === 'top' && !mobile ? pad + ph : pad;
  } else if (!wide && r.height <= avail - 32) top = (avail - r.height) / 2;
  else top = 16;
  window.scrollTo(0, Math.max(0, scrollY + r.top - head - top));
}

function place() {
  const t = T;
  if (!t) return;
  const step = STEPS[t.i];
  if (t.el && !t.el.isConnected) t.el = findTarget(step.target); // 畫面重畫過
  const el = t.el;
  const pop = t.pop;
  const vw = innerWidth;
  const vh = innerHeight;
  const M = 12;
  const mobile = vw < 720;
  t.root.classList.toggle('center', !el);
  t.root.classList.toggle('mobile', mobile);
  if (!el) {
    t.spot.hidden = true;
    pop.style.left = `${Math.max(M, (vw - pop.offsetWidth) / 2)}px`;
    pop.style.top = `${Math.max(M, (vh - pop.offsetHeight) / 2)}px`;
    return;
  }
  // 框起來的範圍（只算畫面看得到的部分）
  const pad = 8;
  const r0 = el.getBoundingClientRect();
  const top0 = el.closest('#side') ? 0 : Math.max(0, headH());
  const r = {
    left: Math.max(4, r0.left - pad), right: Math.min(vw - 4, r0.right + pad),
    top: Math.max(top0 + 4, r0.top - pad), bottom: Math.min(vh - 4, r0.bottom + pad),
  };
  if (r.bottom < r.top + 24) r.bottom = r.top + 24;
  // 很高的卡片（比畫面還高）：只框住看得到的上半部，下面留位置給教學卡片
  const ph0 = pop.offsetHeight;
  const need = ph0 + 14 + M;
  const wideT = mobile || r.right - r.left > vw * 0.45;
  if (wideT && vh - r.bottom < need && r.top - top0 < need && r.bottom - r.top > 200) r.bottom = Math.max(r.top + 140, vh - need);
  t.spot.hidden = false;
  Object.assign(t.spot.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  // 教學卡片放旁邊空間夠的地方
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const gap = 14;
  let x;
  let y;
  if (mobile) {
    x = M;
    y = r.bottom + gap + ph < vh - M ? r.bottom + gap : vh - ph - M;
  } else {
    const fits = {
      right: vw - r.right - gap >= pw + M,
      left: r.left - gap >= pw + M,
      bottom: vh - r.bottom - gap >= ph + M,
      top: r.top - gap - top0 >= ph + M,
    };
    const order = step.place ? [step.place, 'right', 'bottom', 'top', 'left'] : (r.right - r.left > vw * 0.45 ? ['bottom', 'top', 'right', 'left'] : ['right', 'bottom', 'left', 'top']);
    const side = order.find((s) => fits[s]);
    const cy = Math.min(Math.max(r.top, top0 + M), vh - ph - M);
    const cx = Math.min(Math.max(r.left + (r.right - r.left - pw) / 2, M), vw - pw - M);
    if (side === 'right') { x = r.right + gap; y = cy; } else if (side === 'left') { x = r.left - gap - pw; y = cy; } else if (side === 'bottom') { x = cx; y = r.bottom + gap; } else if (side === 'top') { x = cx; y = r.top - gap - ph; } else { x = vw - pw - M * 2; y = vh - ph - M * 2; } // 都放不下：放右下角
  }
  pop.style.left = `${Math.round(Math.min(Math.max(M, x), vw - pw - M))}px`;
  pop.style.top = `${Math.round(Math.min(Math.max(M, y), vh - ph - M))}px`;
}
