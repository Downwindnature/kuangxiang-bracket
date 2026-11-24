// admin/page-display.js — 顯示屏設定：通知看板、賽程與比分、顯示內容與外觀
import { S, saveBanner, saveSettings, saveBracket, emit, teamNames, publicTeamsPayload } from './state.js?v=c2f13502';
import { analyze, allMatches, matchTitle, roundNames, setResult, clearResult, setScores, setTime, autoTimes, getNode, playOrder, publicView, teamCount } from '../bracket.js?v=c2f13502';
import { withDefaults, resolveNext, liveText, extraLines, BANNER_DEFAULTS } from '../banner.js?v=c2f13502';
import { createBannerUI } from '../bannerui.js?v=c2f13502';
import { renderBracket } from '../render.js?v=c2f13502';
import { regStats } from '../importer.js?v=c2f13502';
import { esc } from '../util.js?v=c2f13502';
import { toast, modal, confirmDlg, pageHead } from './ui.js?v=c2f13502';

let timer = null;
let pvUI = null; // 看板預覽
export function cleanup() {
  clearInterval(timer);
  timer = null;
  if (pvUI) pvUI.destroy();
  pvUI = null;
}
const CLOCK_LINE = '現在時間：{日期} {星期} {時間}';

function pubBracket() {
  return S.bracket ? publicView(S.bracket, teamNames(), S.bracket.reveal) : null;
}

function matchLabel(A, n, names) {
  const nm = (id) => (id ? names[id] || '未命名' : '待定');
  return `${matchTitle(A, n)}${n.time ? '｜' + n.time : ''}｜${nm(n.ent[0])} VS ${nm(n.ent[1])}${n.done ? '（已結束）' : ''}`;
}

export function render(main) {
  cleanup();
  const tab = S.ui.displayTab || 'banner';
  main.innerHTML = `
    ${pageHead('顯示屏設定', 'display')}
    <p class="lead">前台顯示屏直接讀取「表單匯入」與「選手抽籤」的資料；這裡設定看板通知、比分與各種顯示細節，改完立即同步到前台。</p>
    <div class="tabs">
      <button data-tab="banner" class="${tab === 'banner' ? 'on' : ''}">通知看板</button>
      <button data-tab="matches" class="${tab === 'matches' ? 'on' : ''}">賽程與比分</button>
      <button data-tab="look" class="${tab === 'look' ? 'on' : ''}">顯示內容與外觀</button>
      <a class="btn ghost right" id="openFront" href="index.html" target="_blank" rel="noopener">開啟前台顯示屏 ↗</a>
    </div>
    <div id="tabBody"></div>`;
  main.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    S.ui.displayTab = b.dataset.tab;
    render(main);
  });
  const body = main.querySelector('#tabBody');
  if (tab === 'banner') renderBanner(body);
  else if (tab === 'matches') renderMatches(body);
  else renderLook(body);
}

// ── 通知看板 ──
function renderBanner(body) {
  cleanup(); // 同一頁重畫時，先停掉舊的預覽
  const b = S.banner;
  const pb = pubBracket();
  const A = pb ? analyze(pb) : null;
  const names = teamNames();
  const order = A ? playOrder(A) : [];
  const ready = order.filter((n) => n.ready);
  const curOpts = ready.map((n) => `<option value="${esc(n.id)}" ${String(b.cur) === String(n.id) ? 'selected' : ''}>${esc(matchLabel(A, n, names))}</option>`).join('');
  const nextOpts = ready.filter((n) => !n.done).map((n) => `<option value="${esc(n.id)}" ${String(b.next) === String(n.id) ? 'selected' : ''}>${esc(matchLabel(A, n, names))}</option>`).join('');
  const d = b.dur, t = b.tpl;
  const modeLabel = (bb, now) => {
    if (bb.mode === 'result' && (now - (bb.at || 0)) / 1000 >= bb.dur.result) return '下一場請準備';
    return { idle: '待機', flow: '對戰流程', result: '勝負公告', custom: '自訂公告', draw: '抽籤' }[bb.mode] || bb.mode;
  };
  const modeText = modeLabel(b, S.store.now());
  const published = !!(S.bracket && S.bracket.published);
  const marquee = b.look === 'marquee';
  const nowMs = S.store.now();
  const ex = (tk) => esc(liveText(tk, nowMs));
  const xCount = extraLines(Object.assign({}, b, { extraOn: true })).length;
  body.innerHTML = `
    <section class="card" id="bnPreview">
      <h3>看板預覽 <span class="tag" id="bnModeTag">${esc(modeText)}</span></h3>
      <div class="pv-banner"><div class="pv-scale"><section class="banner pv"><div class="bn-inner"></div></section></div><p class="pv-empty" hidden>前台看板目前是空白（賽事標題、待機文字都沒有填）</p></div>
      <div class="opt-row">
        <span>看板樣式</span>
        <label class="chk"><input type="radio" name="bnLook" value="board" ${marquee ? '' : 'checked'}> 一般（內容依時間輪流切換）</label>
        <label class="chk"><input type="radio" name="bnLook" value="marquee" ${marquee ? 'checked' : ''}> 跑馬燈（文字由右往左捲動）</label>
        <label class="chk">跑馬燈速度
          <select id="bnSpeed" ${marquee ? '' : 'disabled'}>
            ${[['slow', '慢'], ['normal', '普通'], ['fast', '快']].map(([v, l]) => `<option value="${v}" ${String(b.speed) === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      ${marquee
    ? '<p class="hint">跑馬燈：<b>正在比賽中</b>的對戰、<b>下一場請準備</b>與額外句子排成一列輪流捲動（不受下面的秒數影響）。按「開始這場」「結束本場、登錄比分」、發布公告或抽出新的一組時，會立刻換成新的內容。</p>'
    : `<p class="hint">前台最上方的固定顯示屏。對戰流程：<b>VS</b>（${d.vs} 秒）→ <b>正在比賽中</b>（${d.live} 秒）→ <b>下一場請準備</b>（${d.next} 秒）${b.loop ? '→ 循環' : ''}。按「結束本場、登錄比分」後先顯示勝負公告（${d.result} 秒），接著一直顯示<b>下一場請準備</b>，直到按「開始下一場」。</p>`}
    </section>
    <section class="card" id="bnFlow">
      <h3>對戰流程</h3>
      ${!published ? '<p class="warn-box">賽程還沒公布到前台。先到「選手抽籤」抽籤並公布，這裡才有場次可以選。</p>' : ''}
      <div class="form-grid">
        <label>目前場次<select id="bnCur"><option value="">（請選擇）</option>${curOpts}</select></label>
        <label>下一場<select id="bnNext"><option value="auto" ${b.next === 'auto' ? 'selected' : ''}>自動（依時間順序找下一場）</option><option value="none" ${b.next === 'none' ? 'selected' : ''}>不顯示下一場</option>${nextOpts}</select></label>
      </div>
      <div class="btns">
        <button id="bnStart" class="primary">▶ 開始這場（顯示 VS）</button>
        <button id="bnNextNow">⏭ 立即顯示「下一場請準備」</button>
        <button id="bnFinish">🏁 結束本場、登錄比分</button>
        <button id="bnStartNext">⏩ 開始下一場</button>
        <button id="bnIdle" class="ghost">⏸ 回到待機</button>
      </div>
    </section>
    <section class="card" id="bnCustomCard">
      <h3>自訂公告</h3>
      <textarea id="bnCustom" rows="3" placeholder="例如：比賽即將開始&#10;請各隊長確認隊員到齊（最多 3 行，第 1 行最大）">${esc(b.custom || '')}</textarea>
      <div class="btns"><button id="bnCustomGo" class="primary">📢 發布公告</button><button id="bnCustomOff" class="ghost">取消公告</button></div>
    </section>
    <section class="card" id="bnExtra">
      <h3>額外顯示句子 <span class="tag ${b.extraOn !== false && xCount ? 'ok' : ''}">${b.extraOn === false ? '已關閉' : xCount ? `${xCount} 句` : '沒有設定'}</span></h3>
      <label class="chk"><input type="checkbox" id="xOn" ${b.extraOn !== false ? 'checked' : ''}> 在看板上顯示額外句子</label>
      <textarea id="xText" rows="3" placeholder="一行一句，最多 10 句。例如：&#10;${esc(CLOCK_LINE)}&#10;請各隊隊長在比賽開始前 10 分鐘進入自訂房">${esc(b.extra || '')}</textarea>
      <div class="inline">
        <label>一般樣式每句顯示 <input id="xEvery" type="number" min="2" max="120" value="${esc(b.extraEvery)}" style="width:72px"> 秒</label>
        <button id="xClock" class="ghost">＋ 加入「現在時間」這句</button>
      </div>
      <p class="hint">即時代碼（會一直更新）：<code>{日期}</code> → ${ex('{日期}')}、<code>{星期}</code> → ${ex('{星期}')}、<code>{時間}</code> → ${ex('{時間}')}；也可以分開用 <code>{年}</code> <code>{月}</code> <code>{日}</code> <code>{時}</code> <code>{分}</code> <code>{秒}</code>，<code>{T}</code> = 賽事標題。<br>一般樣式：顯示在看板右下角，有好幾句時輪流換；待機又沒有賽事標題時改顯示在正中間。跑馬燈：接在比賽訊息後面一起捲動。</p>
      <div class="btns"><button id="xSave" class="primary">儲存並套用到前台</button><button id="xClear" class="ghost">清空</button></div>
    </section>
    <details class="card fold" id="bnTiming" ${S.ui.bnTimingOpen ? 'open' : ''}>
      <summary><h3>顯示時間與文字 <span class="hint">VS ${d.vs} 秒・比賽中 ${d.live} 秒・下一場 ${d.next} 秒・勝負公告 ${d.result} 秒</span></h3></summary>
      <div class="form-grid four">
        <label>VS 畫面（秒）<input type="number" min="0" max="120" id="dVs" value="${d.vs}"></label>
        <label>正在比賽中（秒）<input type="number" min="1" max="600" id="dLive" value="${d.live}"></label>
        <label>下一場請準備（秒）<input type="number" min="0" max="120" id="dNext" value="${d.next}"></label>
        <label>勝負公告（秒）<input type="number" min="1" max="120" id="dResult" value="${d.result}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="dLoop" ${b.loop ? 'checked' : ''}> 比賽中與下一場提示循環顯示（關掉就只跳一次「下一場請準備」）</label>
      <div class="form-grid two">
        <label>VS 畫面<input id="tVs" value="${esc(t.vs)}"></label>
        <label>比賽中（對戰文字）<input id="tLive" value="${esc(t.live)}"></label>
        <label>比賽中標籤<input id="tLiveTag" value="${esc(t.liveTag)}"></label>
        <label>下一場請準備<input id="tNext" value="${esc(t.next)}"></label>
        <label>勝負公告<input id="tResult" value="${esc(t.result)}"></label>
        <label>冠軍公告<input id="tChamp" value="${esc(t.champ)}"></label>
        <label>待機文字（留空 = 顯示賽事標題；兩個都留空 = 看板空白）<input id="tIdle" value="${esc(t.idle)}"></label>
      </div>
      <p class="hint">{A}、{B} = 兩隊名稱，{W} = 勝隊，{R} = 輪次，{T} = 賽事標題。文字裡的「VS」會自動加上特效。</p>
      <div class="btns"><button id="bnSave" class="primary">儲存</button><button id="bnDefault" class="ghost">恢復預設文字</button></div>
    </details>`;

  const $ = (id) => body.querySelector('#' + id);
  const pvBanner = body.querySelector('.banner.pv');
  const pvScale = body.querySelector('.pv-scale');
  pvUI = createBannerUI(pvBanner, { now: () => S.store.now(), base: 'banner pv' });
  const ui = pvUI;
  const tick = () => {
    if (ui !== pvUI) return;
    const w = pvScale.parentElement.clientWidth;
    const s = Math.min(1, w / 1480);
    pvScale.style.transform = `scale(${s})`;
    pvScale.parentElement.style.height = 156 * s + 'px';
    const tag = body.querySelector('#bnModeTag');
    if (tag) tag.textContent = modeLabel(S.banner, S.store.now());
    ui.update({ banner: S.banner, bracket: pubBracket(), settings: S.settings });
    const empty = pvBanner.classList.contains('is-blank');
    const hint = body.querySelector('.pv-empty');
    if (hint && hint.hidden === empty) hint.hidden = !empty;
  };
  body.querySelector('#bnTiming').addEventListener('toggle', (e) => { S.ui.bnTimingOpen = e.target.open; });
  tick();
  timer = setInterval(tick, 250);

  const setBanner = async (patch, msg) => {
    S.banner = withDefaults(Object.assign({}, S.banner, patch));
    await saveBanner();
    ui.reset();
    tick();
    if (msg) toast(msg);
  };
  // 看板樣式：一般／跑馬燈（切換後立即套用到前台）
  body.querySelectorAll('input[name=bnLook]').forEach((r) => {
    r.onchange = async () => {
      await setBanner({ look: r.value }, r.value === 'marquee' ? '前台看板已換成跑馬燈樣式' : '前台看板已換成一般樣式');
      renderBanner(body);
    };
  });
  $('bnSpeed').onchange = async () => { await setBanner({ speed: $('bnSpeed').value }, '已調整跑馬燈速度'); };
  // 額外顯示句子
  $('xClock').onclick = () => {
    const ta = $('xText');
    const ls = ta.value.split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (ls.includes(CLOCK_LINE)) return toast('已經有這一句了', { type: 'warn' });
    ta.value = [...ls, CLOCK_LINE].join('\n');
    $('xOn').checked = true;
    toast('已加入，按「儲存並套用到前台」就會顯示');
  };
  $('xSave').onclick = async () => {
    const lines = $('xText').value.split(/\n/).map((x) => x.trim()).filter(Boolean);
    if (lines.length > 10) toast('最多 10 句，超過的部分不會顯示', { type: 'warn' });
    const every = Number($('xEvery').value);
    await setBanner({
      extra: lines.join('\n'),
      extraOn: $('xOn').checked,
      extraEvery: Number.isFinite(every) ? Math.max(2, Math.min(120, every)) : BANNER_DEFAULTS.extraEvery,
    }, !$('xOn').checked ? '已關閉額外句子' : lines.length ? '額外句子已套用到前台' : '已儲存（目前沒有句子）');
    renderBanner(body);
  };
  $('xClear').onclick = async () => {
    if (!S.banner.extra) { $('xText').value = ''; return; }
    if (!(await confirmDlg('清空所有額外顯示句子？'))) return;
    await setBanner({ extra: '' }, '已清空額外句子');
    renderBanner(body);
  };
  $('bnCur').onchange = () => { S.banner.cur = $('bnCur').value || null; };
  $('bnNext').onchange = async () => { await setBanner({ next: $('bnNext').value }); };
  const freshA = () => { const p = pubBracket(); return p ? analyze(p) : null; };
  $('bnStart').onclick = async () => {
    const cur = $('bnCur').value;
    if (!cur) return toast('請先選目前場次', { type: 'warn' });
    const A2 = freshA();
    const cn = A2 && getNode(A2, cur);
    if (cn && cn.done) return toast('這場已經結束了，請選還沒打的場次（或按「開始下一場」）', { type: 'warn' });
    await setBanner({ mode: 'flow', cur, next: $('bnNext').value, at: S.store.now() }, '已開始：前台顯示 VS');
    renderBanner(body);
  };
  $('bnNextNow').onclick = async () => {
    if (!S.banner.cur) return toast('請先開始一場比賽', { type: 'warn' });
    const A2 = freshA();
    if (!resolveNext(S.banner, A2)) return toast('目前沒有可顯示的下一場', { type: 'warn' });
    const dd = S.banner.dur;
    const cn = getNode(A2, S.banner.cur);
    if (!cn || cn.done || dd.next <= 0) {
      // 本場已經結束：一直顯示「下一場請準備」，直到按「開始下一場」
      await setBanner({ mode: 'result', at: S.store.now() - dd.result * 1000 - 1 }, '前台顯示「下一場請準備」');
    } else {
      // 本場還在比：先跳出下一場請準備，之後回到正在比賽中
      await setBanner({ mode: 'flow', at: S.store.now() - (dd.vs + dd.live) * 1000 }, '前台跳出「下一場請準備」');
    }
    renderBanner(body);
  };
  $('bnFinish').onclick = () => {
    const id = S.banner.cur || $('bnCur').value;
    if (!id) return toast('請先選目前場次', { type: 'warn' });
    openResultDialog(id, () => renderBanner(body));
  };
  $('bnStartNext').onclick = async () => {
    const nx = resolveNext(S.banner, freshA());
    if (!nx) return toast('沒有下一場了（或兩隊還沒確定）', { type: 'warn' });
    await setBanner({ mode: 'flow', cur: nx.id, next: 'auto', at: S.store.now() }, '已開始下一場');
    renderBanner(body);
  };
  $('bnIdle').onclick = async () => { await setBanner({ mode: 'idle', at: S.store.now() }, '已回到待機'); renderBanner(body); };
  $('bnCustomGo').onclick = async () => {
    const text = $('bnCustom').value.trim();
    if (!text) return toast('請輸入公告內容', { type: 'warn' });
    await setBanner({ mode: 'custom', custom: text, at: S.store.now() }, '公告已發布');
    renderBanner(body);
  };
  $('bnCustomOff').onclick = async () => {
    await setBanner({ mode: S.banner.cur ? 'flow' : 'idle', at: S.store.now() }, '已取消公告');
    renderBanner(body);
  };
  const num = (id, def, min) => { const v = Number($(id).value); return Number.isFinite(v) && v >= min ? v : def; };
  $('bnSave').onclick = async () => {
    await setBanner({
      dur: { vs: num('dVs', 6, 0), live: num('dLive', 15, 1), next: num('dNext', 6, 0), result: num('dResult', 8, 1) },
      loop: $('dLoop').checked,
      tpl: { vs: $('tVs').value, live: $('tLive').value, liveTag: $('tLiveTag').value, next: $('tNext').value, result: $('tResult').value, champ: $('tChamp').value, idle: $('tIdle').value },
    }, '已儲存');
    renderBanner(body);
  };
  $('bnDefault').onclick = async () => {
    await setBanner({ tpl: Object.assign({}, BANNER_DEFAULTS.tpl) }, '已恢復預設文字');
    renderBanner(body);
  };
}

// ── 登錄比分／勝方 ──
export function openResultDialog(id, after) {
  if (!S.bracket) return toast('還沒有賽程', { type: 'warn' });
  const A = analyze(S.bracket);
  const n = getNode(A, id);
  if (!n || n.type !== 'match') return toast('找不到這場比賽', { type: 'err' });
  if (!n.ready) return toast('這場的兩隊還沒確定', { type: 'warn' });
  const names = teamNames();
  const s = n.score || ['', ''];
  const w0 = n.done ? n.w : null;
  const row = (i) => `<label class="res-row"><input type="radio" name="rw" value="${i}" ${w0 === i ? 'checked' : ''}><span class="res-name">${esc(names[n.ent[i]] || '')}</span><input class="res-score" data-i="${i}" inputmode="numeric" value="${esc(s[i] === undefined ? '' : s[i])}" placeholder="分數"></label>`;
  modal({
    title: `${matchTitle(A, n)}${n.time ? '｜' + n.time : ''}`,
    body: `<p class="hint">輸入比分後選勝方（比分不同時會自動選分數高的一方）。</p>${row(0)}${row(1)}`,
    onOpen(dlg) {
      dlg.querySelectorAll('.res-score').forEach((inp) => {
        inp.addEventListener('input', () => {
          const v = [...dlg.querySelectorAll('.res-score')].map((x) => Number(x.value));
          if (Number.isFinite(v[0]) && Number.isFinite(v[1]) && v[0] !== v[1] && dlg.querySelectorAll('.res-score')[0].value !== '' && dlg.querySelectorAll('.res-score')[1].value !== '') {
            dlg.querySelector(`input[name=rw][value="${v[0] > v[1] ? 0 : 1}"]`).checked = true;
          }
        });
      });
    },
    buttons: [
      { label: '清除結果', cls: 'ghost', onClick: async () => {
        S.bracket = clearResult(S.bracket, n.id);
        await saveBracket();
        emit('bracket');
        after && after();
        toast('已清除這場結果（後面受影響的場次也一併清除）');
      } },
      { label: '取消', cls: 'ghost' },
      { label: '確認結果', cls: 'primary', onClick: async (close, dlg) => {
        const w = dlg.querySelector('input[name=rw]:checked');
        if (!w) { toast('請選勝方', { type: 'warn' }); return false; }
        const sc = [...dlg.querySelectorAll('.res-score')].map((x) => x.value.trim());
        S.bracket = setResult(S.bracket, n.id, Number(w.value), sc);
        await saveBracket();
        if (String(S.banner.cur) === String(n.id) && S.banner.mode === 'flow') {
          S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'result', at: S.store.now() }));
          await saveBanner();
        }
        emit('bracket');
        after && after();
        toast(n.p === 1 ? '冠軍誕生！' : '結果已更新到前台');
      } },
    ],
  });
}

// ── 賽程與比分 ──
function renderMatches(body) {
  if (!S.bracket) {
    body.innerHTML = '<section class="card"><p>還沒有賽程。請先到 <a href="#draw">選手抽籤</a> 抽籤。</p></section>';
    return;
  }
  const A = analyze(S.bracket);
  const names = teamNames();
  const rn = roundNames(A);
  const nm = (v) => (v === null ? '輪空' : v === undefined ? '待定' : names[v] || '未命名');
  const live = S.banner.mode === 'flow' ? String(S.banner.cur) : null;
  const groups = [];
  for (let r = 1; r <= A.k; r++) {
    const ms = Object.values(A.nodes).filter((n) => n.round === r && n.type !== 'empty').sort((a, b) => a.p - b.p);
    const rows = ms.map((n) => {
      if (n.type === 'bye') return `<div class="mrow bye"><span class="m-bye">${n.ent[n.live] === undefined ? '前一場的勝隊' : esc(nm(n.ent[n.live]))}</span><span class="hint">本輪輪空，直接晉級</span></div>`;
      return matchRow(n, nm, live);
    });
    if (r === A.k && A.third) groups.push(`<h4>季軍賽</h4>${matchRow(A.third, nm, live)}`);
    groups.push(`<h4>${esc(rn[r])}</h4>${rows.join('')}`);
  }
  body.innerHTML = `
    <section class="card">
      <h3>賽程預覽 <span class="hint">（點對戰框可以登錄比分）</span></h3>
      ${S.bracket.published ? '' : '<p class="warn-box">賽程還沒公布到前台（在「選手抽籤」第 ③ 步公布）。這裡先修改不影響前台。</p>'}
      <div class="pv-bracket" id="pvb"></div>
    </section>
    <section class="card">
      <h3>自動排時間</h3>
      <div class="inline">
        <label>第一場<input id="atStart" value="${esc(S.ui.atStart || '21:00')}" size="6"></label>
        <label>每場間隔<input id="atEvery" type="number" min="1" value="${esc(S.ui.atEvery || 30)}" style="width:80px"> 分鐘</label>
        <label class="chk"><input type="checkbox" id="atSame" ${S.ui.atSame ? 'checked' : ''}> 同一輪同時開打</label>
        <button id="atGo">套用到全部場次</button>
      </div>
    </section>
    <section class="card matches" id="mList">${groups.join('')}</section>`;
  const pv = body.querySelector('#pvb');
  const draw = () => {
    const w = pv.clientWidth;
    renderBracket(pv, pubBracket(), { settings: S.settings, liveId: live, interactive: true, fit: { w, h: Math.max(320, Math.min(620, w * 0.5)) }, maxScale: 1 });
    pv.style.height = Math.max(320, Math.min(620, w * 0.5)) + 'px';
  };
  draw();
  pv.addEventListener('click', (e) => {
    const box = e.target.closest('.mb.clickable');
    if (box) openResultDialog(box.dataset.node, () => renderMatches(body));
  });
  body.querySelector('#atGo').onclick = async () => {
    S.ui.atStart = body.querySelector('#atStart').value;
    S.ui.atEvery = Number(body.querySelector('#atEvery').value) || 30;
    S.ui.atSame = body.querySelector('#atSame').checked;
    try {
      S.bracket = autoTimes(S.bracket, { start: S.ui.atStart, every: S.ui.atEvery, sameRound: S.ui.atSame });
    } catch (e) { return toast(e.message, { type: 'err' }); }
    await saveBracket();
    toast('時間已排好');
    renderMatches(body);
  };
  const list = body.querySelector('.matches');
  list.addEventListener('change', async (e) => {
    const row = e.target.closest('.mrow[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.classList.contains('m-time')) {
      S.bracket = setTime(S.bracket, id, e.target.value);
    } else if (e.target.classList.contains('m-s')) {
      const sc = [...row.querySelectorAll('.m-s')].map((x) => x.value.trim());
      S.bracket = setScores(S.bracket, id, sc);
    } else return;
    await saveBracket();
    draw();
  });
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const row = btn.closest('.mrow');
    const id = row.dataset.id;
    const act = btn.dataset.act;
    if (act === 'win0' || act === 'win1') {
      const sc = [...row.querySelectorAll('.m-s')].map((x) => x.value.trim());
      const A2 = analyze(S.bracket);
      const n = getNode(A2, id);
      if (n.done && n.w !== Number(act.slice(3)) && !(await confirmDlg('改判勝方後，後面已經打完、受影響的場次結果會被清除。確定要改嗎？', { danger: true, ok: '改判' }))) return;
      S.bracket = setResult(S.bracket, id, Number(act.slice(3)), sc);
      await saveBracket();
      if (String(S.banner.cur) === String(id) && S.banner.mode === 'flow') {
        S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'result', at: S.store.now() }));
        await saveBanner();
      }
      toast('結果已更新');
    } else if (act === 'clear') {
      if (!(await confirmDlg('清除這場結果？後面受影響的場次也會一併清除。'))) return;
      S.bracket = clearResult(S.bracket, id);
      await saveBracket();
    } else if (act === 'cur') {
      S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'flow', cur: id, at: S.store.now() }));
      await saveBanner();
      toast('已設為目前場次，前台顯示 VS');
    }
    renderMatches(body);
  });
}

function matchRow(n, nm, live) {
  const s = n.score || ['', ''];
  const status = n.done ? '<span class="tag ok">已結束</span>' : live === String(n.id) ? '<span class="tag live">比賽中</span>' : n.ready ? '<span class="tag">可開始</span>' : '<span class="tag dim">等待前一場</span>';
  const dis = n.ready ? '' : 'disabled';
  return `<div class="mrow ${n.done ? 'done' : ''} ${!n.done && live === String(n.id) ? 'live' : ''}" data-id="${esc(n.id)}">
    <input class="m-time" value="${esc(n.time)}" placeholder="時間" maxlength="5">
    <span class="m-team ${n.done && n.w === 0 ? 'win' : ''}">${esc(nm(n.ent[0]))}</span>
    <input class="m-s" value="${esc(s[0] ?? '')}" inputmode="numeric" ${dis}>
    <span class="m-colon">:</span>
    <input class="m-s" value="${esc(s[1] ?? '')}" inputmode="numeric" ${dis}>
    <span class="m-team ${n.done && n.w === 1 ? 'win' : ''}">${esc(nm(n.ent[1]))}</span>
    <span class="m-act">
      <button data-act="win0" ${dis} title="左邊這隊獲勝">左勝</button>
      <button data-act="win1" ${dis} title="右邊這隊獲勝">右勝</button>
      <button data-act="clear" ${n.done ? '' : 'disabled'} class="ghost">清除</button>
      <button data-act="cur" ${n.ready && !n.done ? '' : 'disabled'} class="ghost">設為目前場次</button>
    </span>
    ${status}
  </div>`;
}

// ── 顯示內容與外觀 ──
function renderLook(body) {
  const st = S.settings;
  const rs = regStats(S.regs);
  const inc = S.teams.filter((t) => t.include).length;
  const ck = (k) => (st[k] !== false ? 'checked' : '');
  const radio = (name, val, label) => `<label class="chk"><input type="radio" name="${name}" value="${val}" ${st[name] === val ? 'checked' : ''}> ${label}</label>`;
  body.innerHTML = `
    <section class="card" id="lkStage">
      <h3>前台顯示內容</h3>
      ${radio('stage', 'auto', '自動：有公布賽程就顯示賽程表，沒有就空白（預設）')}
      ${radio('stage', 'blank', '空白（只留背景與看板）')}
      ${radio('stage', 'teams', '參賽名單（表單匯入／組隊媒合的隊伍）')}
      ${radio('stage', 'bracket', '賽程表')}
    </section>
    <section class="card" id="lkData">
      <h3>表單資料</h3>
      <div class="stats">
        <div class="stat"><b>${rs.total}</b><span>報名筆數</span></div>
        <div class="stat"><b>${rs.players}</b><span>選手人數</span></div>
        <div class="stat"><b>${S.teams.length ? inc : rs.canTeams}</b><span>${S.teams.length ? '已組成隊伍' : '可組成隊伍（估計）'}</span></div>
        <div class="stat"><b>${S.bracket ? teamCount(S.bracket) : 0}</b><span>賽程隊伍${S.bracket && S.bracket.published ? '（已公布）' : ''}</span></div>
      </div>
      <div class="btns"><button id="pushTeams">把參賽名單顯示到前台</button><a class="btn ghost" href="#import">前往表單匯入</a><a class="btn ghost" href="#draw">前往選手抽籤</a></div>
    </section>
    <section class="card" id="lkText">
      <h3>文字與樣式</h3>
      <div class="form-grid two">
        <label>賽事標題（待機時顯示；留空 = 前台看板空白）<input id="sTitle" value="${esc(st.title)}" placeholder="例如：狂想之息 比賽"></label>
        <label>副標題<input id="sSub" value="${esc(st.subtitle)}" placeholder="例如：第五人格｜2027/05/08"></label>
      </div>
      <div class="opt-row"><span>隊伍名稱顯示</span>${radio('nameMode', 'team', '隊伍名稱')}${radio('nameMode', 'captain', '隊長暱稱')}${radio('nameMode', 'both', '隊伍名稱（隊長）')}</div>
      <div class="chk-grid">
        <label class="chk"><input type="checkbox" id="sThird" ${S.bracket ? (S.bracket.third ? 'checked' : '') : 'checked'} ${S.bracket ? '' : 'disabled'}> 季軍賽（兩場準決賽都是正式比賽時才會出現）</label>
        <label class="chk"><input type="checkbox" id="sTimes" ${ck('showTimes')}> 顯示時間</label>
        <label class="chk"><input type="checkbox" id="sScores" ${ck('showScores')}> 顯示比分</label>
        <label class="chk"><input type="checkbox" id="sZero" ${ck('showZero')}> 還沒打的場次比分顯示 0</label>
        <label class="chk"><input type="checkbox" id="sChamp" ${ck('showChampion')}> 決賽後顯示冠軍名稱</label>
        <label class="chk"><input type="checkbox" id="sMembers" ${ck('listMembers')}> 參賽名單顯示隊員暱稱</label>
        <label class="chk"><input type="checkbox" id="sBtn" ${ck('showAdminBtn')}> 顯示「進入後台」按鈕</label>
        <label class="chk"><input type="checkbox" id="sGrid" ${ck('gridMotion')}> 背景格線動畫</label>
      </div>
      <p class="hint">用 OBS 擷取前台時，網址後面加 <code>?obs=1</code> 可以隱藏「進入後台」按鈕與滑鼠游標。</p>
      <div class="btns"><button id="sSave" class="primary">儲存並套用到前台</button></div>
    </section>`;
  const $ = (id) => body.querySelector('#' + id);
  const collect = () => {
    const pick = (name) => (body.querySelector(`input[name=${name}]:checked`) || {}).value;
    Object.assign(S.settings, {
      stage: pick('stage') || 'auto',
      nameMode: pick('nameMode') || 'team',
      title: $('sTitle').value.trim(),
      subtitle: $('sSub').value.trim(),
      showTimes: $('sTimes').checked,
      showScores: $('sScores').checked,
      showZero: $('sZero').checked,
      showChampion: $('sChamp').checked,
      listMembers: $('sMembers').checked,
      showAdminBtn: $('sBtn').checked,
      gridMotion: $('sGrid').checked,
    });
  };
  $('sSave').onclick = async () => {
    collect();
    if (S.bracket && S.bracket.third !== $('sThird').checked) {
      S.bracket = Object.assign({}, S.bracket, { third: $('sThird').checked });
      await saveBracket();
    }
    await saveSettings();
    toast('已套用到前台');
  };
  body.querySelectorAll('input[name=stage]').forEach((r) => {
    r.onchange = async () => { collect(); await saveSettings(); toast('前台顯示內容已切換'); };
  });
  $('pushTeams').onclick = async () => {
    const p = publicTeamsPayload();
    if (!p.teams.length && !p.waiting.length) return toast('還沒有報名資料', { type: 'warn' });
    S.settings.stage = 'teams';
    await saveSettings();
    toast(`前台已顯示參賽名單（${p.teams.length} 隊）`);
    renderLook(body);
  };
}
