// admin/page-players.js — 選手列表：所有報名選手一次列出（遊戲暱稱、遊戲 ID、Discord、隊伍…）
// 右上角「設定」裡有進階欄位（預設不顯示；離開這一頁就自動收起）
import { S, rm } from './state.js?v=2628f905';
import { toast, modal, confirmDlg, pageHead } from './ui.js?v=2628f905';
import { esc } from '../util.js?v=2628f905';
import { teamLabel } from '../matcher.js?v=2628f905';
import { firstRoundSlots } from '../bracket.js?v=2628f905';
import * as I from '../importer.js?v=2628f905';
import { rosterTag, openRegDialog } from './page-import.js?v=2628f905';
import * as P from './power.js?v=2628f905';

const TYPE_TEXT = { 3: '3 人隊伍', 2: '2 人報名', 1: '1 人報名' };
const FILTERS = [['all', '全部'], ['3', '3 人隊伍'], ['2', '2 人報名'], ['1', '1 人報名'], ['noteam', '還沒進隊伍'], ['flag', '需要確認'], ['excluded', '不列入']];

export function cleanup() {
  // 離開這一頁（不是同一頁重畫）：進階欄位自動收起
  if (location.hash !== '#players') S.ui.plShow = false;
}

function allRows() {
  const m = rm();
  const where = {};
  for (const t of S.teams) t.members.forEach((ref, idx) => { where[`${ref.r}#${ref.i}`] = { t, idx }; });
  const rows = [];
  S.regs.forEach((r, ri) => {
    r.players.forEach((p, i) => {
      const at = where[`${r.id}#${i}`] || null;
      const cap = at ? at.t.cap === at.idx : r.type !== 1 && r.capIdx === i;
      rows.push({ r, ri, i, p, at, cap, team: at ? teamLabel(at.t, m, 'team') : '' });
    });
  });
  return rows;
}

export function render(main) {
  const rows = allRows();
  const st = I.regStats(S.regs);
  const active = rows.filter((x) => !x.r.excluded);
  const inTeam = active.filter((x) => x.at && x.at.t.include).length;
  main.innerHTML = `
    ${pageHead('選手列表', 'players')}
    <p class="lead">所有報名的選手一次列出：遊戲暱稱、遊戲 ID、Discord、報名方式和目前的隊伍。點任何一位選手可以修改那筆報名資料。</p>
    <section class="card" id="plStats">
      <div class="stats">
        <div class="stat"><b>${active.length}</b><span>選手人數</span></div>
        <div class="stat"><b>${st.t3}</b><span>3 人隊伍</span></div>
        <div class="stat"><b>${st.t2}</b><span>2 人報名</span></div>
        <div class="stat"><b>${st.t1}</b><span>1 人報名</span></div>
        <div class="stat"><b>${S.teams.length ? inTeam : '—'}</b><span>已進入隊伍</span></div>
        <div class="stat"><b>${st.flagged}</b><span>需要確認</span></div>
      </div>
    </section>
    <section class="card" id="plList">
      <div class="inline toolbar">
        <input id="plQ" type="search" placeholder="搜尋暱稱、遊戲 ID、Discord、隊伍…" value="${esc(S.ui.plQuery || '')}">
        <div class="seg" id="plF">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" class="${(S.ui.plFilter || 'all') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <label class="inline-sel">排序 <select id="plSort"></select></label>
        <span class="spacer"></span>
        <button id="plCsv" class="ghost">匯出 CSV</button>
        <button id="plSet" class="ghost" title="這一頁的設定">⚙ 設定</button>
      </div>
      <div class="tbl-wrap"><table class="tbl players" id="plTbl"></table></div>
    </section>`;
  const $ = (id) => main.querySelector('#' + id);
  $('plQ').oninput = (e) => { S.ui.plQuery = e.target.value; drawTable(main); };
  $('plF').onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    S.ui.plFilter = b.dataset.f;
    $('plF').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    drawTable(main);
  };
  $('plSort').onchange = (e) => { S.ui.plSort = e.target.value; drawTable(main); };
  $('plCsv').onclick = () => exportCsv();
  $('plSet').onclick = () => openSettings(main);
  drawTable(main);
}

function sortOptions() {
  const o = [['reg', '報名順序'], ['nick', '暱稱'], ['gid', '遊戲 ID'], ['team', '隊伍']];
  if (S.ui.plShow) o.push(['power', '戰力（高到低）']);
  return o;
}

function filtered() {
  const q = (S.ui.plQuery || '').trim().toLowerCase();
  const f = S.ui.plFilter || 'all';
  let list = allRows().filter((x) => {
    if (f === 'excluded') { if (!x.r.excluded) return false; } else if (f !== 'all' && x.r.excluded) return false;
    if ((f === '3' || f === '2' || f === '1') && String(x.r.type) !== f) return false;
    if (f === 'noteam' && x.at && x.at.t.include) return false;
    if (f === 'flag' && !(x.r.flags && x.r.flags.length)) return false;
    if (!q) return true;
    return [x.p.nick, x.p.gid, x.r.discord, x.r.teamName, x.team].join(' ').toLowerCase().includes(q);
  });
  let sort = S.ui.plSort || 'reg';
  if (sort === 'power' && !S.ui.plShow) sort = 'reg';
  const cmp = (a, b) => String(a).localeCompare(String(b), 'zh-Hant');
  if (sort === 'nick') list = list.sort((a, b) => cmp(a.p.nick, b.p.nick));
  else if (sort === 'gid') list = list.sort((a, b) => cmp(a.p.gid || '~', b.p.gid || '~'));
  else if (sort === 'team') list = list.sort((a, b) => cmp(a.team || '~', b.team || '~') || a.ri - b.ri || a.i - b.i);
  else if (sort === 'power') list = list.sort((a, b) => (P.playerPower(b.p) || 0) - (P.playerPower(a.p) || 0) || a.ri - b.ri || a.i - b.i);
  return { list, grouped: sort === 'reg' };
}

function contactCell(x, grouped) {
  const r = x.r;
  if (grouped && x.i > 0) return '<span class="dim sm">（同一筆報名）</span>';
  if (!grouped && r.players.length > 1 && x.i > 0) {
    return r.discord ? `${esc(r.discord)}<div class="dim sm">報名者的聯絡方式</div>` : '<span class="dim sm">（同一筆報名）</span>';
  }
  if (I.isDiscordContact(r.contact)) return r.discord ? `<b>${esc(r.discord)}</b>` : '<span class="tag warn">Discord 未填</span>';
  return r.contact ? `<span class="dim">${esc(r.contact)}</span>` : '<span class="dim">—</span>';
}

function drawTable(main) {
  const tbl = main.querySelector('#plTbl');
  const sel = main.querySelector('#plSort');
  const opts = sortOptions();
  if (!opts.some(([k]) => k === (S.ui.plSort || 'reg'))) S.ui.plSort = 'reg';
  sel.innerHTML = opts.map(([k, l]) => `<option value="${k}" ${(S.ui.plSort || 'reg') === k ? 'selected' : ''}>${l}</option>`).join('');
  if (!S.regs.length) {
    tbl.innerHTML = '<tbody><tr><td class="empty">還沒有報名資料，請先到 <a href="#import">表單匯入</a>。</td></tr></tbody>';
    return;
  }
  const { list, grouped } = filtered();
  const show = !!S.ui.plShow;
  const roster = !!S.roster;
  const m = rm();
  let band = 0, lastReg = null;
  const body = list.map((x, n) => {
    const r = x.r;
    if (r.id !== lastReg) { band++; lastReg = r.id; }
    const first = grouped && x.i === 0;
    const flags = x.i === 0 || !grouped ? (r.flags || []).map((f) => `<span class="tag warn">${esc(I.FLAG_TEXT[f] || f)}</span>`).join('') : '';
    const teamCell = x.at
      ? `${esc(x.team)}${x.at.t.include ? '' : ' <span class="tag dim">沒湊滿</span>'}${show ? ` <span class="pw-avg">均 ${P.fmtPower(P.teamPower(x.at.t, m))}</span>` : ''}`
      : r.type === 3 ? `${esc(r.teamName) || '<span class="dim">（未填）</span>'} <span class="dim sm">還沒組隊</span>`
        : `<span class="dim">還沒組隊</span>${r.type === 2 && r.teamName ? `<div class="dim sm">報名隊名：${esc(r.teamName)}</div>` : ''}`;
    const pv = show ? P.playerPower(x.p) : null;
    return `<tr data-id="${esc(r.id)}" class="${r.excluded ? 'excluded' : ''} ${grouped ? `band${band % 2}` : ''} ${first ? 'g-start' : ''}">
      <td class="dim">${n + 1}</td>
      <td class="nick">${x.cap ? '<b class="cap" title="隊長">★</b>' : ''}${esc(x.p.nick) || '<span class="dim">（未填）</span>'}</td>
      <td class="gid">${esc(x.p.gid) || '<span class="dim">—</span>'}</td>
      <td><span class="tag t${r.type}">${TYPE_TEXT[r.type]}</span></td>
      <td>${teamCell}</td>
      <td>${contactCell(x, grouped)}</td>
      <td>${grouped && x.i > 0 ? '' : esc(r.dc)}</td>
      ${roster ? `<td>${rosterTag(x.p.gid)}</td>` : ''}
      <td>${r.excluded ? '<span class="tag dim">不列入</span>' : ''}${flags}</td>
      ${show ? `<td class="pw"><select data-k="${esc(r.id)}#${x.i}" aria-label="戰力">${['<option value="">未設定</option>', ...P.TIERS.map((t) => `<option value="${t.v}" ${pv === t.v ? 'selected' : ''}>${t.v}｜${t.name}</option>`)].join('')}</select></td>` : ''}
    </tr>`;
  }).join('');
  tbl.innerHTML = `<thead><tr><th>#</th><th>遊戲暱稱</th><th>遊戲 ID</th><th>報名方式</th><th>隊伍</th><th>Discord／聯絡方式</th><th>DC 群組</th>${roster ? '<th>名冊</th>' : ''}<th>狀態</th>${show ? '<th>戰力</th>' : ''}</tr></thead>
    <tbody>${body || `<tr><td class="empty" colspan="12">沒有符合的選手</td></tr>`}</tbody>`;
  tbl.onclick = (e) => {
    if (e.target.closest('select, a')) return;
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const reg = S.regs.find((x) => x.id === tr.dataset.id);
    if (reg) openRegDialog(reg, () => render(main));
  };
  tbl.onchange = async (e) => {
    const s = e.target.closest('select[data-k]');
    if (!s) return;
    const [rid, i] = s.dataset.k.split('#');
    const reg = S.regs.find((x) => x.id === rid);
    const p = reg && reg.players[Number(i)];
    if (!p) return;
    if (!(await P.setPlayerPower(p, s.value ? Number(s.value) : null))) { toast('這位選手沒有遊戲 ID 也沒有暱稱，沒辦法設定', { type: 'warn' }); return; }
    drawTable(main);
  };
}

function exportCsv() {
  const show = !!S.ui.plShow;
  const head = ['遊戲暱稱', '遊戲ID', '報名方式', '隊伍', '隊長', '聯絡方式', 'Discord', 'DC群組', '狀態'];
  if (show) head.push('戰力');
  const lines = [head];
  for (const x of filtered().list) {
    const r = x.r;
    const row = [x.p.nick, x.p.gid, TYPE_TEXT[r.type], x.team || r.teamName || '', x.cap ? '是' : '', r.contact, r.discord, r.dc,
      [r.excluded ? '不列入' : '', ...(r.flags || []).map((f) => I.FLAG_TEXT[f] || f)].filter(Boolean).join('、')];
    if (show) row.push(P.tierName(P.playerPower(x.p)));
    lines.push(row);
  }
  const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `狂想之息選手列表_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── 設定（進階欄位只在這裡打開）──
function openSettings(main) {
  const box = document.createElement('div');
  box.className = 'pl-set';
  const players = S.regs.filter((r) => !r.excluded).flatMap((r) => r.players);
  const drawBox = () => {
    const o = P.powerOpts();
    const set = players.filter((p) => P.playerPower(p) != null).length;
    box.innerHTML = `
      <label class="chk big"><input type="checkbox" id="pwShow" ${S.ui.plShow ? 'checked' : ''}> 顯示戰力</label>
      <p class="hint">勾選後，列表最右邊會多一欄可以直接設定每位選手的戰力；離開「選手列表」這一頁就會自動隱藏，下次要再勾選。其他頁面都不會顯示。</p>
      <div class="pw-panel" ${S.ui.plShow ? '' : 'hidden'}>
        <h4>戰力等級</h4>
        <div class="chips">${P.TIERS.map((t) => `<span class="chip">${t.v}｜${t.name}</span>`).join('')}</div>
        <p class="hint">已設定 ${set} / ${players.length} 位選手。以遊戲 ID 記錄，重新同步表單也不會不見；隊伍戰力 = 隊員平均（沒設定的隊員不算）。</p>
        <h4>抽籤時參考戰力</h4>
        <label class="chk"><input type="checkbox" id="pwDraw" ${o.draw ? 'checked' : ''}> 「選手抽籤 ② 抽籤」時，第一輪盡量讓戰力相近的隊伍對戰（輪空一樣隨機抽）</label>
        <label class="inline-sel">兩隊平均戰力最多差 <select id="pwGap">${P.GAPS.map((g) => `<option value="${g}" ${Number(o.gap) === g ? 'selected' : ''}>${g} 階${g === 1 ? '（建議）' : ''}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="pwMatch" ${o.match ? 'checked' : ''}> 「隨機媒合組隊」時，讓 1 人、2 人報名媒合出來的各隊戰力平均一點</label>
        <p class="hint">只影響之後按下的抽籤／媒合，已經抽好的賽程不會變；整隊都沒有設定戰力的隊伍當作平均值。選手抽籤頁不會顯示這些設定。</p>
        ${firstRoundTable(o)}
        <h4>一次貼上設定</h4>
        <textarea id="pwBulk" rows="4" placeholder="每行一位：遊戲 ID（或暱稱） 戰力，例如：&#10;12345678 中高階&#10;87654321 5&#10;（寫 0 代表清除）"></textarea>
        <div class="btns"><button id="pwApply" class="primary">套用</button><span class="spacer"></span><button id="pwClear" class="danger ghost">清除全部戰力</button></div>
      </div>`;
    const q = (id) => box.querySelector('#' + id);
    q('pwShow').onchange = (e) => {
      S.ui.plShow = e.target.checked;
      if (!S.ui.plShow && S.ui.plSort === 'power') S.ui.plSort = 'reg';
      drawTable(main);
      drawBox();
    };
    if (!S.ui.plShow) return;
    q('pwDraw').onchange = async (e) => { await P.setPowerOpts({ draw: e.target.checked }); drawBox(); };
    q('pwGap').onchange = async (e) => { await P.setPowerOpts({ gap: Number(e.target.value) }); drawBox(); };
    q('pwMatch').onchange = async (e) => { await P.setPowerOpts({ match: e.target.checked }); };
    q('pwApply').onclick = async () => {
      const res = await P.bulkApply(q('pwBulk').value, S.regs.flatMap((r) => r.players));
      if (!res.ok && !res.miss.length && !res.bad.length) return toast('沒有可以套用的內容', { type: 'warn' });
      const parts = [`已套用 ${res.ok} 位`];
      if (res.miss.length) parts.push(`找不到 ${res.miss.length} 位（${res.miss.slice(0, 3).join('、')}${res.miss.length > 3 ? '…' : ''}）`);
      if (res.bad.length) parts.push(`${res.bad.length} 行看不懂`);
      toast(parts.join('，'), { type: res.miss.length || res.bad.length ? 'warn' : 'ok', ms: 6000 });
      drawTable(main);
      drawBox();
    };
    q('pwClear').onclick = async () => {
      if (!P.hasAnyPower()) return toast('目前沒有設定任何戰力');
      if (!(await confirmDlg('清除所有選手的戰力設定？', { danger: true, ok: '清除' }))) return;
      await P.clearAllPower();
      toast('已清除');
      drawTable(main);
      drawBox();
    };
  };
  drawBox();
  modal({ title: '選手列表設定', body: box, wide: true, buttons: [{ label: '關閉', cls: 'primary' }] });
}

// 目前賽程的第一輪：兩隊戰力與差距（確認抽籤結果用）
function firstRoundTable(o) {
  const br = S.bracket;
  if (!br || !br.leaves) return '';
  const m = rm();
  const team = (id) => S.teams.find((t) => t.id === id);
  const names = {};
  for (const t of S.teams) names[t.id] = teamLabel(t, m, 'team');
  const { pairs } = firstRoundSlots(br.leaves.map((x) => (x ? 1 : 0)));
  if (!pairs.length) return '';
  const rows = pairs.map(([a, b]) => {
    const ta = br.leaves[a], tb = br.leaves[b];
    const pa = P.teamPower(team(ta), m), pb = P.teamPower(team(tb), m);
    const gap = pa != null && pb != null ? Math.abs(pa - pb) : null;
    return { ta, tb, pa, pb, gap };
  });
  const worst = Math.max(0, ...rows.map((x) => x.gap || 0));
  return `
    <details class="pw-first" ${worst > Number(o.gap) ? 'open' : ''}>
      <summary>目前賽程第一輪：${rows.length} 場，最大差距 ${P.fmtPower(worst)} 階${worst > Number(o.gap) ? '（有超過設定的差距）' : ''}</summary>
      <table class="tbl small"><thead><tr><th>隊伍</th><th>戰力</th><th>對手</th><th>戰力</th><th>差距</th></tr></thead><tbody>
        ${rows.map((x) => `<tr class="${x.gap != null && x.gap > Number(o.gap) ? 'warnrow' : ''}"><td>${esc(names[x.ta] || '')}</td><td>${P.fmtPower(x.pa)}</td><td>${esc(names[x.tb] || '')}</td><td>${P.fmtPower(x.pb)}</td><td>${x.gap == null ? '—' : P.fmtPower(x.gap)}</td></tr>`).join('')}
      </tbody></table>
    </details>`;
}
