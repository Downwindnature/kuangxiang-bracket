// admin/page-draw.js — 選手抽籤：組隊媒合 → 賽程抽籤（含輪空設定）→ 公布／逐一揭曉
import { S, saveTeams, saveBracket, saveBanner, saveSettings, saveDraw, snapshot, emit, rm, teamNames } from './state.js?v=f641a603';
import { buildTeams, refreshTeams, swapMembers, memberInfo, teamComplete, regMap } from '../matcher.js?v=f641a603';
import { matchOptions, drawOptions } from './power.js?v=f641a603';
import { createBracket, analyze, makeMask, byeSummary, roundCounts, roundNames, swapLeaves, publicView, teamCount, hasResults, MODE_ODD, MODE_POW2, MAX_TEAMS } from '../bracket.js?v=f641a603';
import { renderBracket } from '../render.js?v=f641a603';
import { regStats } from '../importer.js?v=f641a603';
import { withDefaults, DRAW_FX } from '../banner.js?v=f641a603';
import * as L from './livedraw.js?v=f641a603';
import { esc } from '../util.js?v=f641a603';
import { toast, confirmDlg, pageHead } from './ui.js?v=f641a603';
import { rosterTag } from './page-import.js?v=f641a603';

let busyTimer = null;
let onSpy = null;
export function cleanup() {
  L.stopAuto();
  L.bindView(null);
  clearInterval(busyTimer);
  busyTimer = null;
  if (onSpy) removeEventListener('scroll', onSpy);
  onSpy = null;
}
const stopAuto = () => L.stopAuto();

const MODE_TEXT = {
  [MODE_ODD]: '依比賽規則 二-3：每一輪隊伍數為單數時，抽 1 隊輪空直接晉級',
  [MODE_POW2]: '補滿到 2 的次方：輪空集中在第 1 輪（例如 18 隊 → 第 1 輪只打 2 場）',
};

export function render(main) {
  if (onSpy) removeEventListener('scroll', onSpy); // 同一頁重畫（直播抽籤每抽一組也會重畫）：只換掉捲動偵測，不能停掉自動抽籤
  onSpy = null;
  main.innerHTML = `
    ${pageHead('選手抽籤', 'draw')}
    <p class="lead">從現有的所有報名抽籤分隊：3 人報名直接成隊；1 人、2 人報名的選手隨機媒合成 3 人一隊。組好隊伍後抽進賽程表，可以自動處理輪空，也可以手動調整位置。</p>
    <nav class="jump" aria-label="跳到">
      <button type="button" data-jump="s1">① 組隊媒合<small>${S.teams.length ? `${S.teams.filter((t) => t.include).length} 隊` : '還沒組隊'}</small></button>
      <button type="button" data-jump="s2">② 賽程抽籤<small>${S.bracket ? `${teamCount(S.bracket)} 隊` : '還沒抽籤'}</small></button>
      <button type="button" data-jump="s3">③ 公布到顯示屏<small>${S.bracket && S.bracket.reveal ? '直播抽籤中' : S.bracket && S.bracket.published ? '已公布' : '還沒公布'}</small></button>
    </nav>
    <section class="card" id="s1"></section>
    <section class="card" id="s2"></section>
    <section class="card" id="s3"></section>`;
  drawTeams(main);
  drawBracketStep(main);
  drawPublish(main);
  // 上方的 ①②③：點了跳到那一區，捲動時標示目前在哪一區
  const head = () => (document.querySelector('.top') || { offsetHeight: 0 }).offsetHeight + (main.querySelector('.jump') || { offsetHeight: 0 }).offsetHeight + 16;
  main.querySelector('.jump').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    if (!b) return;
    const sec = main.querySelector('#' + b.dataset.jump);
    window.scrollTo({ top: Math.max(0, sec.getBoundingClientRect().top + scrollY - head()), behavior: 'smooth' });
  });
  onSpy = () => {
    const y = head() + 24;
    let cur = 's1';
    for (const id of ['s1', 's2', 's3']) { const el = main.querySelector('#' + id); if (el && el.getBoundingClientRect().top <= y) cur = id; }
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = 's3';
    main.querySelectorAll('.jump [data-jump]').forEach((b) => b.classList.toggle('on', b.dataset.jump === cur));
  };
  addEventListener('scroll', onSpy, { passive: true });
  onSpy();
}

// ── ① 組隊媒合 ──
function drawTeams(main) {
  const box = main.querySelector('#s1');
  const st = regStats(S.regs);
  const m = rm();
  const inc = S.teams.filter((t) => t.include);
  const picked = S.ui.pickMember || null;
  const cards = S.teams.map((t) => {
    const complete = teamComplete(t, m);
    const slots = t.members.map((ref, i) => {
      const info = memberInfo(m, ref);
      const isPicked = picked && picked.team === t.id && picked.idx === i;
      return `<li class="mem ${isPicked ? 'picked' : ''}" data-team="${t.id}" data-idx="${i}">
        <label class="cap" title="設為隊長"><input type="radio" name="cap_${t.id}" data-cap="${i}" ${t.cap === i ? 'checked' : ''}>★</label>
        <span class="nick">${info ? esc(info.nick || '（未填暱稱）') : '<span class="dim">（報名已刪除）</span>'}</span>
        <span class="gid">${info ? esc(info.gid) : ''}</span>${info ? rosterTag(info.gid) : ''}
        ${info && info.reg.type !== 3 ? `<span class="tag dim">${info.reg.type} 人報名</span>` : ''}
      </li>`;
    }).join('');
    const empties = Array.from({ length: Math.max(0, 3 - t.members.length) }, (_, j) => `<li class="mem empty" data-team="${t.id}" data-idx="${t.members.length + j}">＋ 空位${picked ? '（點這裡移入）' : ''}</li>`).join('');
    return `<div class="tcard ${t.include ? '' : 'off'} ${complete ? '' : 'incomplete'}" data-team="${t.id}">
      <div class="tc-head"><input class="tc-name" data-team="${t.id}" value="${esc(t.name)}" maxlength="24"><span class="tag ${t.origin === 'self' ? 'ok' : ''}">${t.origin === 'self' ? '自行組隊' : '媒合'}</span></div>
      <ol class="tc-mem">${slots}${empties}</ol>
      <div class="tc-foot">
        <label class="chk"><input type="checkbox" class="tc-inc" data-team="${t.id}" ${t.include ? 'checked' : ''}> 參加抽籤</label>
        ${!complete ? '<span class="tag warn">人數不足</span>' : ''}${t.capPending ? '<span class="tag dim">隊長待確認</span>' : ''}
      </div>
    </div>`;
  }).join('');
  box.innerHTML = `
    <h3>① 組隊媒合</h3>
    <p>報名：3 人隊伍 <b>${st.t3}</b>、2 人報名 <b>${st.t2}</b> 組、1 人報名 <b>${st.t1}</b> 位 → 預計可組成 <b>${st.canTeams}</b> 隊${st.leftPairs || st.leftSingles ? `，候補：${st.leftPairs ? `${st.leftPairs} 組缺 1 人` : ''}${st.leftPairs && st.leftSingles ? '、' : ''}${st.leftSingles ? `${st.leftSingles} 位落單` : ''}` : ''}。</p>
    <div class="btns">
      ${S.teams.length ? `<button id="tRe" class="primary">🎲 重新隨機媒合</button><button id="tAdd">＋ 補進新報名的選手</button><button id="tClear" class="ghost">清空隊伍</button>` : `<button id="tBuild" class="primary" ${S.regs.length ? '' : 'disabled'}>🎲 隨機媒合組隊</button>`}
      ${S.teams.length ? `<span class="hint">目前 ${S.teams.length} 隊，參加抽籤 ${inc.length} 隊</span>` : ''}
    </div>
    ${S.teams.length ? `<p class="hint">點一位選手，再點另一位選手（或空位）就可以交換／移動。★ 是隊長。媒合隊伍的名稱可以直接改。</p><div class="tgrid">${cards}</div>` : (S.regs.length ? '' : '<p class="hint">還沒有報名資料，請先到 <a href="#import">表單匯入</a>。</p>')}`;

  const q = (id) => box.querySelector('#' + id);
  const afterTeams = async (msg) => {
    await saveTeams();
    emit('teams');
    if (msg) toast(msg);
    render(main);
  };
  const keepSelfIds = (fresh) => {
    for (const t of fresh) {
      if (t.origin !== 'self') continue;
      const old = S.teams.find((o) => o.origin === 'self' && o.members[0] && t.members[0] && o.members[0].r === t.members[0].r);
      if (old) { t.id = old.id; t.name = old.name; t.cap = old.cap; t.include = old.include && t.include; }
    }
    return fresh;
  };
  if (q('tBuild')) q('tBuild').onclick = async () => {
    S.teams = buildTeams(S.regs, matchOptions());
    await afterTeams(`已組成 ${S.teams.filter((t) => t.include).length} 隊`);
  };
  if (q('tRe')) q('tRe').onclick = async () => {
    const warn = S.bracket ? '\n\n注意：目前的抽籤結果會被清除（前台賽程也會撤下）。' : '';
    if (!(await confirmDlg(`重新隨機媒合 1 人、2 人報名的選手？自行組隊的 3 人隊伍不會變。${warn}`, { ok: '重新媒合', danger: !!S.bracket }))) return;
    await snapshot('重新媒合前');
    S.teams = keepSelfIds(buildTeams(S.regs, matchOptions()));
    if (S.bracket) { S.bracket = null; await saveBracket(); }
    await afterTeams('已重新媒合');
  };
  if (q('tAdd')) q('tAdd').onclick = async () => {
    const r = refreshTeams(S.teams, S.regs, matchOptions());
    if (!r.added) { toast('沒有新的選手需要補進來'); S.teams = r.teams; return afterTeams(); }
    S.teams = r.teams;
    await afterTeams(`已補進 ${r.added} 隊（新報名的選手）`);
  };
  if (q('tClear')) q('tClear').onclick = async () => {
    if (!(await confirmDlg('清空所有隊伍？（會先自動備份）' + (S.bracket ? '抽籤結果也會一起清除。' : ''), { danger: true, ok: '清空' }))) return;
    await snapshot('清空隊伍前');
    S.teams = [];
    if (S.bracket) { S.bracket = null; await saveBracket(); }
    await afterTeams('已清空隊伍');
  };
  box.querySelectorAll('.tc-name').forEach((inp) => {
    inp.onchange = async () => {
      const t = S.teams.find((x) => x.id === inp.dataset.team);
      t.name = inp.value.trim();
      t.autoName = false;
      await saveTeams();
      emit('teams');
      drawBracketStep(main);
    };
  });
  box.querySelectorAll('input[data-cap]').forEach((r) => {
    r.onchange = async () => {
      const t = S.teams.find((x) => x.id === r.closest('.tcard').dataset.team);
      t.cap = Number(r.dataset.cap);
      t.capPending = false;
      await afterTeams();
    };
  });
  box.querySelectorAll('.tc-inc').forEach((c) => {
    c.onchange = async () => {
      const t = S.teams.find((x) => x.id === c.dataset.team);
      if (c.checked && !teamComplete(t, m) && !(await confirmDlg('這隊不滿 3 人（比賽規則是固定 3 人）。還是要讓它參加抽籤嗎？', { ok: '仍然參加' }))) { c.checked = false; return; }
      t.include = c.checked;
      await afterTeams();
    };
  });
  box.querySelectorAll('.mem').forEach((li) => {
    li.addEventListener('click', async (e) => {
      if (e.target.closest('.cap')) return;
      const here = { team: li.dataset.team, idx: Number(li.dataset.idx) };
      const cur = S.ui.pickMember;
      if (!cur) {
        if (li.classList.contains('empty')) return;
        S.ui.pickMember = here;
        drawTeams(main);
        return;
      }
      S.ui.pickMember = null;
      if (cur.team === here.team && cur.idx === here.idx) { drawTeams(main); return; }
      S.teams = swapMembers(S.teams, cur, here);
      await afterTeams('已交換');
    });
  });
}

// ── ② 賽程抽籤 ──
function structureText(n, mode) {
  const st = makeMask(n, mode);
  if (!st) return '';
  const br = { k: st.k, leaves: st.mask.map((v, i) => (v ? 'x' + i : '')), m: {}, third: false };
  const A = analyze(br);
  const counts = roundCounts(A);
  const byes = byeSummary(A);
  const rn = roundNames(A);
  const parts = [];
  for (let r = 1; r <= A.k; r++) {
    const matches = Object.values(A.nodes).filter((x) => x.round === r && x.type === 'match').length;
    parts.push(`<span class="chip">${esc(rn[r])}：${counts[r]} 隊 → ${matches} 場${byes[r].length ? `，<b>${byes[r].length} 隊輪空</b>` : ''}</span>`);
  }
  return parts.join('');
}

function drawBracketStep(main) {
  const box = main.querySelector('#s2');
  const inc = S.teams.filter((t) => t.include);
  const mode = S.ui.drawMode || (S.bracket && S.bracket.mode) || MODE_ODD;
  const third = S.ui.drawThird != null ? S.ui.drawThird : S.bracket ? S.bracket.third : true;
  const br = S.bracket;
  const names = teamNames();
  let warn = '';
  if (br) {
    const inBr = new Set(br.leaves.filter(Boolean));
    const missing = inc.filter((t) => !inBr.has(t.id));
    const gone = [...inBr].filter((id) => !inc.some((t) => t.id === id));
    if (missing.length || gone.length) warn = `<p class="warn-box">隊伍有變動：${missing.length ? `${missing.map((t) => esc(names[t.id])).join('、')} 不在賽程裡` : ''}${missing.length && gone.length ? '；' : ''}${gone.length ? `賽程裡有 ${gone.length} 隊已不參加抽籤` : ''}。需要的話請重新抽籤。</p>`;
  }
  const A = br ? analyze(br) : null;
  const byes = A ? byeSummary(A) : [];
  const byeLines = [];
  if (A) {
    const rn = roundNames(A);
    for (let r = 1; r <= A.k; r++) {
      for (const n of byes[r]) {
        const t = n.ent[n.live];
        byeLines.push(`${esc(rn[r])}：${t ? esc(names[t] || '') : '前一場的勝隊'}`);
      }
    }
  }
  box.innerHTML = `
    <h3>② 賽程抽籤</h3>
    <div class="opt-col">
      <span class="lbl">輪空方式</span>
      ${[MODE_ODD, MODE_POW2].map((m) => `<label class="chk"><input type="radio" name="dmode" value="${m}" ${mode === m ? 'checked' : ''}> ${MODE_TEXT[m]}</label>`).join('')}
      <label class="chk"><input type="checkbox" id="dThird" ${third ? 'checked' : ''}> 季軍賽（兩場準決賽都是正式比賽時才會產生）</label>
    </div>
    <p>參加抽籤：<b>${inc.length}</b> 隊 ${inc.length > MAX_TEAMS ? `<span class="warnc">（上限 ${MAX_TEAMS} 隊）</span>` : ''}</p>
    <div class="chips">${inc.length >= 2 ? structureText(inc.length, mode) : '<span class="hint">至少要 2 隊才能抽籤</span>'}</div>
    <div class="btns">
      <button id="dDraw" class="primary" ${inc.length >= 2 && inc.length <= MAX_TEAMS ? '' : 'disabled'}>${br ? '🎲 重新抽籤' : '🎲 抽籤'}</button>
      ${br ? '<button id="dClear" class="ghost">清除抽籤</button>' : ''}
    </div>
    ${warn}
    ${br ? `
      <p class="hint">${br.published ? '已公布：在這裡交換位置，前台會同步更新。' : '還沒公布，前台看不到。'}點一隊、再點另一隊可以交換位置（例如指定由哪一隊輪空）。</p>
      ${byeLines.length ? `<p>輪空：${byeLines.map((x) => `<span class="chip">${x}</span>`).join('')}</p>` : '<p class="hint">這次沒有輪空。</p>'}
      <div class="pv-bracket" id="dPv"></div>` : ''}`;

  box.querySelectorAll('input[name=dmode]').forEach((r) => {
    r.onchange = () => { S.ui.drawMode = r.value; drawBracketStep(main); };
  });
  box.querySelector('#dThird').onchange = async (e) => {
    S.ui.drawThird = e.target.checked;
    if (S.bracket) {
      S.bracket = Object.assign({}, S.bracket, { third: e.target.checked });
      await saveBracket();
    }
    drawBracketStep(main);
  };
  box.querySelector('#dDraw').onclick = async () => {
    if (br) {
      const played = hasResults(br);
      if (!(await confirmDlg(`重新抽籤會換掉目前的對戰組合${played ? '，已登錄的比賽結果（勝方、比分）也會清除' : ''}${br.published ? '，前台的賽程會先撤下，抽完要再公布一次' : ''}。確定嗎？`, { danger: true, ok: '重新抽籤' }))) return;
      await snapshot('重新抽籤前');
    }
    S.bracket = createBracket(inc.map((t) => t.id), Object.assign({ mode, third }, drawOptions(regMap(S.regs))));
    S.bracket.published = false;
    S.bracket.reveal = null;
    S.bracket.drawnAt = Date.now();
    S.ui.pickLeaf = null;
    stopAuto();
    await saveBracket();
    if (S.banner.mode === 'flow' || S.banner.mode === 'result' || S.banner.mode === 'draw') {
      S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'idle', cur: null, draw: null }));
      await saveBanner();
    }
    emit('bracket');
    toast(`抽籤完成：${inc.length} 隊`);
    render(main);
  };
  if (box.querySelector('#dClear')) box.querySelector('#dClear').onclick = async () => {
    if (!(await confirmDlg('清除抽籤結果？前台的賽程會撤下（會先自動備份）。', { danger: true, ok: '清除' }))) return;
    await snapshot('清除抽籤前');
    stopAuto();
    S.bracket = null;
    await saveBracket();
    S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'idle', cur: null, draw: null }));
    await saveBanner();
    emit('bracket');
    render(main);
  };
  const pv = box.querySelector('#dPv');
  if (pv && br) {
    const w = pv.clientWidth || 900;
    const h = Math.max(320, Math.min(640, w * 0.52));
    pv.style.height = h + 'px';
    renderBracket(pv, publicView(br, names, null), { settings: Object.assign({}, S.settings, { showScores: false, showTimes: true }), interactive: true, selectedLeaf: S.ui.pickLeaf, fit: { w, h }, maxScale: 1 });
    pv.addEventListener('click', async (e) => {
      const row = e.target.closest('.mb-row[data-leaf]');
      if (!row) return;
      const leaf = Number(row.dataset.leaf);
      if (S.ui.pickLeaf == null) { S.ui.pickLeaf = leaf; drawBracketStep(main); return; }
      const a = S.ui.pickLeaf;
      S.ui.pickLeaf = null;
      if (a === leaf) { drawBracketStep(main); return; }
      const played = Object.values(S.bracket.m || {}).some((x) => x.w === 0 || x.w === 1);
      if (played && !(await confirmDlg('已經有比賽結果，交換位置後受影響的結果會被清除。確定嗎？', { danger: true, ok: '交換' }))) { drawBracketStep(main); return; }
      S.bracket = Object.assign(swapLeaves(S.bracket, a, leaf), { published: S.bracket.published, reveal: S.bracket.reveal, drawnAt: S.bracket.drawnAt });
      await saveBracket();
      emit('bracket');
      toast('已交換位置');
      drawBracketStep(main);
    });
  }
}

// ── ③ 公布／直播抽籤 ──
function startBusyTicker() {
  clearInterval(busyTimer);
  const tick = () => {
    const left = L.busyLeftMs();
    const btn = document.getElementById('rNext');
    if (btn) {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `前台動畫播放中…（${Math.ceil(left / 1000)} 秒）` : btn.dataset.label;
    }
    if (left <= 0) { clearInterval(busyTimer); busyTimer = null; }
  };
  busyTimer = setInterval(tick, 200);
  tick();
}

function drawPublish(main) {
  const box = main.querySelector('#s3');
  const br = S.bracket;
  if (!br) { box.innerHTML = '<h3>③ 公布到顯示屏</h3><p class="hint">抽籤後才能公布。前台在公布之前都是空白。</p>'; return; }
  const total = teamCount(br);
  const info = L.liveInfo();
  const { steps, revealing } = info;
  const p = L.fxPrefs();
  const status = !br.published ? '尚未公布（前台空白）'
    : !revealing ? '已公布'
      : steps ? `直播抽籤中：已抽出 ${info.pairsShown} / ${info.pairsTotal} 組` : `逐一揭曉中：${info.shown} / ${(br.reveal.order || []).length}`;
  const drawn = steps ? L.drawnList().map((d) => (d.pair
    ? `<li>第 ${d.n} 組：<b>${esc(d.names[0])}</b> VS <b>${esc(d.names[1])}</b></li>`
    : `<li>${d.names.length > 1 ? '剩下的隊伍' : '最後一隊'}：${d.names.map((x) => `<b>${esc(x)}</b>`).join('、')}</li>`)).join('') : '';
  const results = hasResults(br);
  box.innerHTML = `
    <h3>③ 公布到顯示屏 <span class="tag ${br.published ? 'ok' : ''}">${status}</span></h3>
    <div class="btns">
      <button id="pAll" class="primary">📢 一次公布全部</button>
      <button id="pReveal">🎰 直播抽籤（抽籤球動畫）</button>
      ${br.published || revealing ? '<button id="pBall">🖥 打開抽籤球畫面</button>' : ''}
      ${br.published ? '<button id="pHide" class="ghost">撤下賽程（前台變空白）</button>' : ''}
    </div>
    <div class="inline fx-opts">
      <label class="chk"><input type="checkbox" id="fxOn" ${p.fx ? 'checked' : ''}> 播放抽籤球動畫</label>
      <label>滾動 <input id="fxTumble" type="number" min="1" max="10" step="0.5" value="${p.tumble}" style="width:72px"> 秒</label>
      <label>抽出後停留 <input id="fxHold" type="number" min="0.5" max="15" step="0.5" value="${p.hold}" style="width:72px"> 秒</label>
      <label>自動抽籤每組間隔 <input id="rGap" type="number" min="0" max="30" step="0.5" value="${p.gap}" style="width:72px"> 秒</label>
    </div>
    <p class="hint">按「直播抽籤」後，後台會切換成全螢幕的抽籤球畫面，在那裡一組一組抽；前台同步播放動畫。直播抽籤依照 ② 抽好的組合揭曉，想換組合請先按 ② 的「重新抽籤」。${results ? '<br><b class="warnc">目前已經有比賽結果，開始直播抽籤會先清除結果（會自動備份）。</b>' : ''}</p>
    ${revealing && steps ? `
      <div class="reveal-box">
        <div class="btns">
          <button id="rNext" class="primary big" data-label="${esc(info.label)}">${esc(info.label)}</button>
          <button id="rAuto">${L.isAuto() ? '⏸ 暫停自動抽籤' : '▶ 自動抽籤'}</button>
          <button id="rAllNow" class="ghost">直接全部揭曉</button>
        </div>
        <p class="hint">每按一次抽出一組（第一場會互相對戰的兩隊）：${p.fx ? `前台先播放約 ${p.tumble} 秒的抽籤球滾動動畫，接著跑出兩顆球顯示兩隊名稱，再飛進賽程表。` : '動畫已關閉，前台直接顯示這一組。'}沒有直接對手的隊伍（第 1 輪輪空）留到最後直接揭曉，不播動畫。自動抽籤時請讓這個後台分頁保持開啟。</p>
        ${drawn ? `<ul class="drawn-list">${drawn}</ul>` : ''}
      </div>` : ''}
    ${info.legacy ? `
      <div class="reveal-box">
        <p class="warn-box">這是舊版「逐一揭曉」的進度。請按「直接全部揭曉」，或按上面的「直播抽籤」從頭開始。</p>
        <div class="btns"><button id="rAllNow" class="primary">直接全部揭曉</button></div>
      </div>` : ''}
    <p class="hint">公布後，前台顯示內容是「自動」或「賽程表」時就會出現賽程。${total} 隊，直播抽籤會分成 ${info.plan.filter((x) => x.pair).length} 組${info.plan.some((x) => !x.pair) ? '＋最後剩下的隊伍' : ''}。</p>`;

  const q = (id) => box.querySelector('#' + id);
  L.bindView(() => { if (document.body.contains(box)) render(main); });
  q('pAll').onclick = async () => {
    L.stopAuto();
    S.bracket = Object.assign({}, S.bracket, { published: true, reveal: null });
    if (S.banner.mode === 'draw') S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'draw', at: S.store.now(), draw: { done: true, total } }));
    if (S.settings.stage === 'blank' || S.settings.stage === 'teams') {
      S.settings.stage = 'auto';
      await saveSettings();
    }
    await saveDraw();
    emit('bracket');
    toast('賽程已公布到前台');
    render(main);
  };
  q('pReveal').onclick = async () => {
    if (await L.startLiveDraw()) location.hash = '#drawball';
  };
  if (q('pBall')) q('pBall').onclick = () => { location.hash = '#drawball'; };
  if (q('pHide')) q('pHide').onclick = async () => {
    L.stopAuto();
    S.bracket = Object.assign({}, S.bracket, { published: false, reveal: null });
    if (S.banner.mode === 'draw' || S.banner.mode === 'flow' || S.banner.mode === 'result') {
      S.banner = withDefaults(Object.assign({}, S.banner, { mode: 'idle', cur: null, draw: null }));
    }
    await saveDraw();
    emit('bracket');
    toast('已撤下，前台變回空白');
    render(main);
  };
  q('fxOn').onchange = (e) => { L.saveFxPrefs({ fx: e.target.checked }); drawPublish(main); };
  q('fxTumble').onchange = (e) => { L.saveFxPrefs({ tumble: L.numIn(e.target.value, 1, 10, DRAW_FX.tumble) }); drawPublish(main); };
  q('fxHold').onchange = (e) => { L.saveFxPrefs({ hold: L.numIn(e.target.value, 0.5, 15, DRAW_FX.hold) }); drawPublish(main); };
  q('rGap').onchange = (e) => { L.saveFxPrefs({ gap: L.numIn(e.target.value, 0, 30, 1.5) }); };
  if (q('rNext')) {
    q('rNext').onclick = async () => { if (await L.drawNext()) startBusyTicker(); };
    if (L.busyLeftMs() > 0) startBusyTicker();
  }
  if (q('rAuto')) q('rAuto').onclick = () => { L.toggleAuto(); render(main); startBusyTicker(); };
  if (q('rAllNow')) q('rAllNow').onclick = () => L.revealAllNow();
}
