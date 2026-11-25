// admin/main.js — 後台入口：Firebase 登入 → 選單（顯示屏設定／表單匯入／選手抽籤／重置／回到前台）
import { openStore, firebaseReady } from '../store.js?v=2628f905';
import { DB_ROOT } from '../firebase-config.js?v=2628f905';
import { startStars } from '../bg.js?v=2628f905';
import { S, loadAll, watchRemote, onChange } from './state.js?v=2628f905';
import { regStats } from '../importer.js?v=2628f905';
import { teamCount, analyze, allMatches } from '../bracket.js?v=2628f905';
import { esc } from '../util.js?v=2628f905';
import { toast } from './ui.js?v=2628f905';
import * as PDisplay from './page-display.js?v=2628f905';
import * as PImport from './page-import.js?v=2628f905';
import * as PDraw from './page-draw.js?v=2628f905';
import * as PReset from './page-reset.js?v=2628f905';
import * as PBall from './page-drawball.js?v=2628f905';
import * as PPlayers from './page-players.js?v=2628f905';
import { startTour, startChapter, maybeAutoStart } from './tour.js?v=2628f905';

const PAGES = {
  display: { title: '顯示屏設定', mod: PDisplay, icon: '🖥️', sub: '看板・比分・外觀' },
  import: { title: '表單匯入', mod: PImport, icon: '📋', sub: '報名資料' },
  draw: { title: '選手抽籤', mod: PDraw, icon: '🎲', sub: '組隊・抽籤・公布' },
  players: { title: '選手列表', mod: PPlayers, icon: '👥', sub: '名稱・ID・Discord' },
  reset: { title: '重置', mod: PReset, icon: '♻️', sub: '清空・還原' },
  drawball: { title: '抽籤球畫面', mod: PBall, hidden: true }, // 全螢幕，不放在左邊選單
};

const app = document.getElementById('app');
let current = null;

startStars(document.getElementById('stars'), { density: 0.6 });

async function boot() {
  let store;
  try {
    store = await openStore({ withAuth: true });
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="center-wrap"><div class="card login"><h2>無法連線到 Firebase</h2><p>${esc(e.message || e)}</p><p class="hint">請檢查 js/firebase-config.js 的設定，或確認網路連線。</p><a href="index.html">← 回到前台</a></div></div>`;
    return;
  }
  S.store = store;
  if (store.mode === 'local') { await enter(null); return; }
  store.auth.onChange(async (user) => {
    if (!user) { S.user = null; showLogin(); return; }
    app.innerHTML = '<div class="boot">確認權限中…</div>';
    const ok = await store.auth.isAdmin(user);
    if (!ok) { showNotAdmin(user); return; }
    S.user = user;
    await enter(user);
  });
}

function showLogin(msg = '') {
  app.innerHTML = `
    <div class="center-wrap">
      <form class="card login" id="loginForm" autocomplete="on">
        <div class="login-logo">🏆</div>
        <h2>狂想之息｜後台登入</h2>
        <label>帳號<input name="acc" autocomplete="username" required placeholder="例如：admin"></label>
        <label>密碼<input name="pw" type="password" autocomplete="current-password" required></label>
        <label class="chk"><input type="checkbox" name="remember" checked> 在這台電腦保持登入</label>
        <button class="primary big" type="submit">登入</button>
        <p class="err" id="loginErr">${esc(msg)}</p>
        <p class="hint">帳號密碼由 Firebase Authentication 驗證，不存在網頁程式碼裡。</p>
        <a href="index.html">← 回到前台</a>
      </form>
    </div>`;
  const f = document.getElementById('loginForm');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button');
    btn.disabled = true;
    btn.textContent = '登入中…';
    try {
      await S.store.auth.signIn(f.acc.value, f.pw.value, f.remember.checked);
    } catch (err) {
      const code = (err && err.code) || '';
      const text = /invalid-credential|wrong-password|user-not-found|invalid-email/.test(code) ? '帳號或密碼錯誤'
        : /too-many-requests/.test(code) ? '嘗試太多次，請稍後再試'
          : /network/.test(code) ? '網路連線失敗'
            : /operation-not-allowed/.test(code) ? 'Firebase 還沒啟用「電子郵件／密碼」登入方式'
              : (err && err.message) || '登入失敗';
      document.getElementById('loginErr').textContent = text;
      btn.disabled = false;
      btn.textContent = '登入';
    }
  };
}

function showNotAdmin(user) {
  app.innerHTML = `
    <div class="center-wrap">
      <div class="card login">
        <h2>這個帳號沒有管理權限</h2>
        <p>已登入：${esc(user.email || '')}</p>
        <p>請到 Firebase 主控台 → Realtime Database → 資料，在 <code>${esc(DB_ROOT)}/admins</code> 底下新增一筆：</p>
        <pre class="code">${esc(user.uid)} : true</pre>
        <p class="hint">（README 第 4 步有圖文說明。加好之後重新整理這頁就可以進入後台。）</p>
        <div class="btns"><button id="copyUid">複製 UID</button><button id="out" class="ghost">登出</button></div>
      </div>
    </div>`;
  document.getElementById('copyUid').onclick = () => navigator.clipboard.writeText(user.uid).then(() => toast('已複製 UID'));
  document.getElementById('out').onclick = () => S.store.auth.signOut();
}

async function enter(user) {
  app.innerHTML = '<div class="boot">載入資料中…</div>';
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="center-wrap"><div class="card login"><h2>讀取資料失敗</h2><p>${esc(e.message || e)}</p><p class="hint">如果是 permission denied，請確認已經貼上 database.rules.json 的規則，並把這個帳號加進 admins。</p>${user ? '<button id="out">登出</button>' : ''}</div></div>`;
    const o = document.getElementById('out');
    if (o) o.onclick = () => S.store.auth.signOut();
    return;
  }
  watchRemote();
  const local = S.store.mode === 'local';
  app.innerHTML = `
    <header class="top">
      <a class="brand" href="#home">🏆 狂想之息｜賽程表後台</a>
      <span class="mode ${local ? 'local' : ''}">${local ? '單機測試模式' : '線上模式'}</span>
      <span class="spacer"></span>
      ${user ? '<button id="logout" class="ghost">登出</button>' : ''}
    </header>
    ${local ? `<div class="local-bar"><b>單機測試模式</b>：資料只存在這個瀏覽器（同一個瀏覽器開的前台會同步顯示）。要讓別人看到前台或用 OBS 擷取，請照 README 設定 Firebase。${firebaseReady() ? '（網址有 ?local，所以強制使用單機模式）' : ''}</div>` : ''}
    <div class="shell">
      <nav class="side" id="side">
        <div class="nav-main">
          ${Object.entries(PAGES).filter(([, p]) => !p.hidden).map(([k, p]) => `<a href="#${k}" data-page="${k}"><span class="nv-ic" aria-hidden="true">${p.icon}</span><span class="nv-tx"><b>${p.title}</b><small data-nv="${k}">${p.sub}</small></span></a>`).join('')}
        </div>
        <button type="button" class="nav-help" id="tourBtn"><span class="nv-ic" aria-hidden="true">📖</span><span class="nv-tx"><b>使用教學</b><small>一步一步帶你看</small></span></button>
        <a href="index.html" class="front">回到前台</a>
      </nav>
      <main id="main"></main>
    </div>`;
  const lo = document.getElementById('logout');
  if (lo) lo.onclick = () => S.store.auth.signOut();
  document.getElementById('tourBtn').onclick = () => startTour(0);
  // 每頁標題旁的「？ 這頁怎麼用」、首頁的進度（點了跳到對應的地方）
  document.getElementById('main').addEventListener('click', (e) => {
    const h = e.target.closest('[data-tour]');
    if (h) { startChapter(h.dataset.tour); return; }
    const g = e.target.closest('[data-sec]');
    if (g) S.ui.scrollTo = g.dataset.sec || null;
  });
  if (!entered) {
    entered = true;
    window.addEventListener('hashchange', route);
    onChange(onRemote);
    onChange(() => updateNav());
    setInterval(updateNav, 1500);
  }
  route();
}

// 左邊選單下面的小字：目前進度
function navStatus(k) {
  if (k === 'import') {
    if (!S.regs.length) return { t: '還沒有報名資料' };
    const st = regStats(S.regs);
    return st.flagged ? { t: `${st.total} 筆・${st.flagged} 筆需確認`, cls: 'warn' } : { t: `${st.total} 筆報名`, cls: 'ok' };
  }
  if (k === 'draw') {
    const br = S.bracket;
    if (br && br.reveal) return { t: '直播抽籤中', cls: 'live' };
    if (br && br.published) return { t: `已公布・${teamCount(br)} 隊`, cls: 'ok' };
    if (br) return { t: '已抽籤・還沒公布', cls: 'warn' };
    const inc = S.teams.filter((t) => t.include).length;
    return { t: inc ? `已組成 ${inc} 隊` : '還沒組隊' };
  }
  if (k === 'players') {
    const n = S.regs.filter((r) => !r.excluded).reduce((a, r) => a + r.players.length, 0);
    return { t: n ? `${n} 位選手` : '還沒有選手' };
  }
  if (k === 'display') {
    const m = { flow: ['比賽進行中', 'live'], result: ['比賽進行中', 'live'], custom: ['自訂公告中', 'warn'], draw: ['抽籤畫面', 'live'] }[(S.banner || {}).mode];
    return m ? { t: m[0], cls: m[1] } : { t: '看板待機中' };
  }
  return { t: (PAGES[k] && PAGES[k].sub) || '' };
}
function updateNav() {
  document.querySelectorAll('#side [data-nv]').forEach((el) => {
    const { t, cls = '' } = navStatus(el.dataset.nv);
    if (el.textContent !== t) el.textContent = t;
    const c = `nv-st ${cls}`.trim();
    if (el.className !== c) el.className = c;
  });
}

let entered = false;
function onRemote(why) {
    if (why !== 'remote') return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && document.getElementById('main').contains(a)) return; // 正在輸入時先不重畫
    if (document.querySelector('.mask')) return;
    route({ keepScroll: true }); // 同一頁重畫：停在原本看的位置
    toast('資料已由其他分頁／管理員更新', { type: 'info', ms: 2500 });
}

function route(opt) {
  const keep = !!(opt && opt.keepScroll);
  const y = window.scrollY;
  const key = (location.hash || '#home').slice(1);
  const main = document.getElementById('main');
  if (!main) return;
  if (current && current.mod && current.mod.cleanup) current.mod.cleanup();
  document.querySelectorAll('#side a[data-page]').forEach((a) => a.classList.toggle('on', a.dataset.page === key));
  const page = PAGES[key];
  current = page || null;
  if (!page) { renderHome(main); updateNav(); window.scrollTo(0, 0); setTimeout(maybeAutoStart, 300); return; }
  document.title = `${page.title}｜狂想之息後台`;
  page.mod.render(main);
  updateNav();
  setTimeout(maybeAutoStart, 300); // 第一次進後台：自動開始使用教學
  // 指定要停在哪一區（例如從抽籤球畫面回來 → ③ 公布到顯示屏）
  const target = S.ui.scrollTo && main.querySelector('#' + S.ui.scrollTo);
  S.ui.scrollTo = null;
  if (target) {
    const top = document.querySelector('.top');
    const jump = main.querySelector('.jump'); // 選手抽籤頁上方固定的 ①②③
    const off = (top ? top.offsetHeight : 0) + (jump ? jump.offsetHeight : 0) + 12;
    window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.scrollY - off));
  } else window.scrollTo(0, keep ? y : 0);
}

function renderHome(main) {
  document.title = '狂想之息｜賽程表後台';
  main.innerHTML = `
    <div class="home">
      <div class="home-col">
        <p><b>顯示屏設定</b>　直接接收表單匯入的資料，設定看板通知（誰 VS 誰、正在比賽中、下一場請準備）、比分與各種顯示細節，前台即時顯示給大家看。</p>
        <p><b>表單匯入</b>　匯入 Excel／CSV，或同步 Google 表單的回覆，自動統計並整理所有選手資料：隊伍名稱、隊長、隊員與聯絡方式。</p>
      </div>
      <div class="home-menu">
        <a href="#display">顯示屏設定</a>
        <a href="#import">表單匯入</a>
        <a href="#draw">選手抽籤</a>
        <a href="#players">選手列表</a>
        <a href="#reset">重置</a>
        <a href="index.html">回到前台</a>
      </div>
      <div class="home-col">
        <p><b>選手抽籤</b>　從現有的所有隊伍抽籤分隊；1 人、2 人報名的選手隨機媒合成 3 人一隊，再抽進賽程表，自動處理輪空。</p>
        <p><b>選手列表</b>　所有選手的遊戲暱稱、遊戲 ID、Discord 與隊伍一次列出，可以搜尋、篩選、匯出 CSV。</p>
        <p><b>重置</b>　清空所有選手資料，前台的選手資料也會一起消失；誤按的話可以按「返回」復原。</p>
      </div>
    </div>
    ${homeSteps()}`;
}

// 首頁下方：整體進度（還沒完成的第一步標示「下一步」，點了直接帶過去）
function homeSteps() {
  const st = regStats(S.regs);
  const inc = S.teams.filter((t) => t.include).length;
  const br = S.bracket;
  const live = !!(br && br.reveal);
  const pub = !!(br && br.published && !live);
  let mt = null;
  if (pub) {
    const ms = allMatches(analyze(br));
    mt = { done: ms.filter((n) => n.done).length, total: ms.length };
  }
  const steps = [
    { href: '#import', title: '匯入報名', done: st.total > 0, info: st.total ? `${st.total} 筆${st.flagged ? `・${st.flagged} 筆需確認` : ''}` : '還沒有報名資料', warn: st.flagged > 0 },
    { href: '#draw', sec: 's1', title: '組隊媒合', done: inc > 0, info: inc ? `${inc} 隊` : '還沒組隊' },
    { href: '#draw', sec: 's2', title: '賽程抽籤', done: !!br, info: br ? `${teamCount(br)} 隊` : '還沒抽籤' },
    { href: '#draw', sec: 's3', title: '公布賽程', done: pub, info: live ? '直播抽籤中' : pub ? '已公布' : '還沒公布' },
    { href: '#display', title: '比賽', done: !!(mt && mt.total && mt.done === mt.total), info: mt ? (mt.done === mt.total ? '全部打完 🏆' : `已打完 ${mt.done} / ${mt.total} 場`) : '公布賽程後開始' },
  ];
  const nx = steps.findIndex((x) => !x.done);
  return `
    <div class="home-steps" aria-label="比賽進度">
      ${steps.map((x, i) => `<a class="hs ${x.done ? 'done' : ''} ${i === nx ? 'next' : ''} ${x.warn ? 'warn' : ''}" href="${x.href}" data-sec="${x.sec || ''}">
        <span class="hs-n">${x.done ? '✓' : i + 1}</span>
        <span class="hs-t"><b>${x.title}</b><small>${esc(x.info)}</small></span>
        ${i === nx ? '<em>下一步</em>' : ''}
      </a>`).join('<span class="hs-line" aria-hidden="true"></span>')}
    </div>`;
}

boot();
