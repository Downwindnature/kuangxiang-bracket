// admin/page-players.js — 選手列表：每位選手的遊戲名稱、遊戲 ID、Discord、所屬隊伍
// 點選手 → 選手資料（每一項都可以複製、編輯報名資料）。右上角「⚙ 設定」裡有進階功能，預設關閉；
// 開啟後每位選手資料裡才會多一個「⚙ 設定」，列表本身看起來完全一樣。
import { S, rm } from './state.js?v=cd1fa29e';
import { toast, modal, confirmDlg, pageHead } from './ui.js?v=cd1fa29e';
import { esc } from '../util.js?v=cd1fa29e';
import { teamLabel } from '../matcher.js?v=cd1fa29e';
import * as I from '../importer.js?v=cd1fa29e';
import { openRegDialog } from './page-import.js?v=cd1fa29e';
import * as P from './power.js?v=cd1fa29e';

const COLS = [['nick', '遊戲名稱'], ['gid', '遊戲 ID'], ['discord', 'Discord'], ['team', '所屬隊伍']];
const dim = (t) => `<span class="dim">${t}</span>`;
const W = '\u6230\u529b'; // 只在兩個「⚙ 設定」裡面顯示的字
const rowKey = (x) => `${x.r.id}#${x.i}`;

// Discord：表單每筆報名只有一個（報名者填的），放在那筆報名的第一位選手（3 人隊 = 隊長、2 人 = 隊員 A）
function discordOf(r, i) {
  if (i > 0) return { kind: 'mate', text: '' };
  if (r.discord) return { kind: 'own', text: r.discord };
  if (I.isDiscordContact(r.contact)) return { kind: 'missing', text: '' };
  if (r.contact) return { kind: 'none', text: '' };
  return { kind: 'empty', text: '' };
}

function teamOf(r, t, m) {
  if (t) return { text: teamLabel(t, m, 'team'), note: t.include ? '' : '沒湊滿 3 人' };
  if (r.type === 3) return { text: r.teamName || '', note: r.teamName ? (S.teams.length ? '尚未加入' : '') : '未填隊名' };
  return { text: '', note: '' };
}

function allRows() {
  const m = rm();
  const where = {};
  for (const t of S.teams) t.members.forEach((ref) => { where[`${ref.r}#${ref.i}`] = t; });
  const rows = [];
  S.regs.forEach((r, ri) => {
    if (r.excluded) return;
    r.players.forEach((p, i) => {
      const t = where[`${r.id}#${i}`] || null;
      rows.push({ r, ri, i, p, t, team: teamOf(r, t, m), dc: discordOf(r, i) });
    });
  });
  return rows;
}

export function render(main) {
  main.innerHTML = `
    ${pageHead('選手列表', 'players')}
    <p class="lead">每位選手的遊戲名稱、遊戲 ID、Discord 和所屬隊伍。點選手可以看他的資料。</p>
    <section class="card" id="plList">
      <div class="inline toolbar">
        <input id="plQ" type="search" placeholder="搜尋遊戲名稱、遊戲 ID、Discord、隊伍…" value="${esc(S.ui.plQuery || '')}">
        <span class="dim sm" id="plCount"></span>
        <span class="spacer"></span>
        <button id="plCsv" class="ghost">匯出 CSV</button>
        <button id="plSet" class="ghost">⚙ 設定</button>
      </div>
      <div class="tbl-wrap"><table class="tbl players" id="plTbl"></table></div>
      <p class="hint" id="plEx"></p>
    </section>`;
  const $ = (id) => main.querySelector('#' + id);
  $('plQ').oninput = (e) => { S.ui.plQuery = e.target.value; drawTable(main); };
  $('plCsv').onclick = () => exportCsv();
  $('plSet').onclick = () => openSettings(main);
  drawTable(main);
}

function sorted(rows) {
  const q = (S.ui.plQuery || '').trim().toLowerCase();
  let list = q ? rows.filter((x) => [x.p.nick, x.p.gid, x.dc.text, x.team.text].join(' ').toLowerCase().includes(q)) : rows.slice();
  const { k, d } = S.ui.plSort || { k: 'reg', d: 1 };
  if (k === 'reg') return list;
  const val = (x) => (k === 'nick' ? x.p.nick : k === 'gid' ? x.p.gid : k === 'discord' ? x.dc.text : x.team.text) || '';
  const cmp = (a, b) => {
    const va = val(a), vb = val(b);
    if (!va !== !vb) return va ? -1 : 1;           // 空白的永遠排最後
    return d * va.localeCompare(vb, 'zh-Hant', { numeric: true }) || a.ri - b.ri || a.i - b.i;
  };
  return list.sort(cmp);
}

function dcCell(x) {
  const { kind, text } = x.dc;
  if (kind === 'own') return `<span class="dc">${esc(text)}</span>`;
  if (kind === 'missing') return dim('未填');
  if (kind === 'none') return dim('沒有 Discord');
  if (kind === 'mate' && x.r.discord) return `<span class="dim" title="同一筆報名只填了一個 Discord：${esc(x.r.discord)}">—</span>`;
  return dim('—');
}

function teamCell(x) {
  const { text, note } = x.team;
  if (!text && !note) return dim('尚未分隊');
  return `${text ? esc(text) : ''}${note ? ` <span class="dim sm">${text ? '・' : ''}${note}</span>` : ''}`;
}

function drawTable(main) {
  const tbl = main.querySelector('#plTbl');
  const countEl = main.querySelector('#plCount');
  const ex = S.regs.filter((r) => r.excluded).reduce((a, r) => a + r.players.length, 0);
  main.querySelector('#plEx').textContent = ex ? `另有 ${ex} 位選手的報名設為「不列入」，沒有列在這裡（可以在「表單匯入」查看）。` : '';
  if (!S.regs.length) {
    countEl.textContent = '';
    tbl.innerHTML = '<tbody><tr><td class="empty">還沒有報名資料，請先到 <a href="#import">表單匯入</a>。</td></tr></tbody>';
    return;
  }
  const rows = allRows();
  const list = sorted(rows);
  countEl.textContent = list.length === rows.length ? `共 ${rows.length} 位` : `${list.length} / ${rows.length} 位`;
  const s = S.ui.plSort || { k: 'reg', d: 1 };
  const arrow = (k) => (s.k === k ? `<i class="arr">${s.d > 0 ? '▲' : '▼'}</i>` : '');
  tbl.innerHTML = `<thead><tr><th data-s="reg" class="sortable" title="照報名順序">#</th>${COLS.map(([k, l]) => `<th data-s="${k}" class="sortable" title="依${l}排序">${l}${arrow(k)}</th>`).join('')}</tr></thead>
    <tbody>${list.map((x, n) => `<tr data-k="${esc(rowKey(x))}">
      <td class="dim">${n + 1}</td>
      <td class="nick">${esc(x.p.nick) || dim('（未填）')}</td>
      <td class="gid">${esc(x.p.gid) || dim('—')}</td>
      <td>${dcCell(x)}</td>
      <td>${teamCell(x)}</td>
    </tr>`).join('') || '<tr><td class="empty" colspan="5">沒有符合的選手</td></tr>'}</tbody>`;
  tbl.onclick = (e) => {
    const th = e.target.closest('th[data-s]');
    if (th) {
      const k = th.dataset.s;
      S.ui.plSort = k === 'reg' ? { k, d: 1 } : { k, d: s.k === k ? -s.d : 1 };
      drawTable(main);
      return;
    }
    const tr = e.target.closest('tr[data-k]');
    const x = tr && allRows().find((y) => rowKey(y) === tr.dataset.k);
    if (x) openPlayer(main, x);
  };
}

function exportCsv() {
  const lines = [COLS.map(([, l]) => l.replace(/\s+/g, ''))];
  for (const x of sorted(allRows())) {
    const team = x.team.text || (x.team.note ? '' : '尚未分隊');
    lines.push([x.p.nick, x.p.gid, x.dc.text, team]);
  }
  const csv = '﻿' + lines.map((l) => l.map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `狂想之息選手列表_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (err) { /* 不支援就算了 */ }
    t.remove();
  }
  toast('已複製');
}

const copyBtn = (v) => ` <button type="button" class="mini ghost" data-copy="${esc(v)}">複製</button>`;

function dcDetail(x) {
  const r = x.r;
  const { kind, text } = x.dc;
  if (kind === 'own') return `<span class="dc">${esc(text)}</span>${copyBtn(text)}${r.players.length > 1 ? '<div class="hint">這筆報名填的聯絡 Discord</div>' : ''}`;
  if (kind === 'missing') return dim('報名時選了 Discord，但沒有填使用者名稱');
  if (kind === 'none') return dim('沒有 Discord（聯絡方式：遊戲內好友）');
  if (kind === 'mate') {
    const who = r.players[0] && r.players[0].nick;
    return `${dim('—')}${r.discord ? `<div class="hint">同一筆報名只填了一個 Discord：<b>${esc(r.discord)}</b>${who ? `（${esc(who)}）` : ''}${copyBtn(r.discord)}</div>` : ''}`;
  }
  return dim('—');
}

// ── 選手資料 ──
function openPlayer(main, x) {
  const box = document.createElement('div');
  box.className = 'pl-info';
  const draw = () => {
    box.innerHTML = `
      <dl>
        <dt>遊戲名稱</dt><dd>${x.p.nick ? `<span class="name">${esc(x.p.nick)}</span>${copyBtn(x.p.nick)}` : dim('（未填）')}</dd>
        <dt>遊戲 ID</dt><dd>${x.p.gid ? `<span class="gid">${esc(x.p.gid)}</span>${copyBtn(x.p.gid)}` : dim('—')}</dd>
        <dt>Discord</dt><dd>${dcDetail(x)}</dd>
        <dt>所屬隊伍</dt><dd>${teamCell(x)}${x.team.text ? copyBtn(x.team.text) : ''}</dd>
      </dl>
      ${P.isOn() ? '<div class="pi-more"><button type="button" class="ghost" id="piSetBtn">⚙ 設定</button><div class="pi-set" id="piSet" hidden></div></div>' : ''}`;
    box.onclick = (e) => {
      const c = e.target.closest('[data-copy]');
      if (c) copy(c.dataset.copy);
    };
    const btn = box.querySelector('#piSetBtn');
    if (btn) btn.onclick = () => {
      const el = box.querySelector('#piSet');
      el.hidden = !el.hidden;
      btn.classList.toggle('on', !el.hidden);
      if (!el.hidden) drawSet(el);
    };
  };
  const drawSet = (el) => {
    const v = P.playerPower(x.p);
    el.innerHTML = `
      <h4>${W}</h4>
      <div class="pw-row">
        <input type="range" id="piRange" min="0" max="${P.MAX}" step="1" value="${v == null ? P.BASE_VALUE : v}" aria-label="0 到 ${P.MAX}">
        <input type="number" id="piNum" min="0" max="${P.MAX}" step="1" inputmode="numeric" value="${v == null ? '' : v}" placeholder="未設定">
      </div>
      <p class="hint">0～${P.MAX}，數字越高越強，每一分都會算進去。${v == null ? `目前還沒設定，抽籤時當作 ${P.BASE_VALUE}。` : ''}</p>
      <div class="btns"><button type="button" class="primary" id="piSave">儲存</button><button type="button" class="ghost" id="piClear" ${v == null ? 'disabled' : ''}>清除</button></div>`;
    const range = el.querySelector('#piRange'), num = el.querySelector('#piNum');
    range.oninput = () => { num.value = range.value; };
    num.oninput = () => { const n = P.parseValue(num.value); if (n != null) range.value = n; };
    const save = async (val) => {
      if (!(await P.setPlayerPower(x.p, val))) { toast('這位選手沒有遊戲 ID 也沒有名稱，沒辦法設定', { type: 'warn' }); return; }
      toast(val == null ? '已清除' : '已儲存');
      drawSet(el);
    };
    el.querySelector('#piSave').onclick = () => {
      const n = P.parseValue(num.value);
      if (n == null) { toast(`請輸入 0～${P.MAX} 的數字`, { type: 'warn' }); num.focus(); return; }
      save(n);
    };
    num.onkeydown = (e) => { if (e.key === 'Enter') el.querySelector('#piSave').click(); };
    el.querySelector('#piClear').onclick = () => save(null);
  };
  draw();
  modal({
    title: '選手資料',
    body: box,
    buttons: [
      { label: '編輯報名資料', cls: 'ghost', onClick: (close) => { close(); openRegDialog(x.r, () => render(main)); } },
      { label: '關閉', cls: 'primary' },
    ],
  });
}

// ── 選手列表設定 ──
function openSettings(main) {
  const box = document.createElement('div');
  box.className = 'pl-set';
  const draw = () => {
    const on = P.isOn();
    const o = P.powerOpts();
    const list = S.regs.filter((r) => !r.excluded).flatMap((r) => r.players);
    const gapText = (g) => `${g} 分${g === 5 ? '（最接近）' : g === 10 ? '（建議）' : g === 30 ? '（比較隨機）' : ''}`;
    box.innerHTML = `
      <label class="switch-row"><input type="checkbox" id="pwOn" ${on ? 'checked' : ''}><span class="sw" aria-hidden="true"></span><b>啟用${W}</b></label>
      <p class="hint">${on
        ? `已開啟：每位選手的資料裡多了一個「⚙ 設定」，可以設定 0～${P.MAX}（越高越強，沒設定的當作 ${P.BASE_VALUE}）。之後按下的「隨機媒合組隊」和「抽籤」會參考這些數字，讓每一隊第一場碰到的對手實力接近；輪空的隊伍一樣照規則隨機抽。`
        : `目前關閉：媒合和抽籤都照原本的方式完全隨機。打開後，每位選手的資料裡會多一個「⚙ 設定」，可以設定 0～${P.MAX}。`}</p>
      <p class="hint">不管開或關，列表和其他頁面都不會顯示任何相關內容；關閉也不會刪掉已經設定的數字。已經抽好的賽程不會變。</p>
      ${on ? `
        <p class="pw-count">已設定 <b>${P.countSet(list)}</b> / ${list.length} 位選手</p>
        <details class="fold" id="pwAdv" ${S.ui.pwAdv ? 'open' : ''}><summary><h3>進階</h3></summary>
          <label class="inline-sel">第一場兩邊差距上限 <select id="pwGap">${P.GAPS.map((g) => `<option value="${g}" ${Number(o.gap) === g ? 'selected' : ''}>${gapText(g)}</option>`).join('')}</select></label>
          <p class="hint">上限越小，對手越接近，但抽籤的變化越少；真的找不到這麼接近的對手時，會挑最接近的。</p>
          <label class="chk"><input type="checkbox" id="pwMatch" ${o.match ? 'checked' : ''}> 「隨機媒合組隊」時，讓 1 人、2 人報名組出來的隊伍實力平均一點</label>
          <h4>一次貼上設定</h4>
          <textarea id="pwBulk" rows="4" placeholder="每行一位：遊戲 ID（或遊戲名稱） 數字&#10;12345678 80&#10;87654321 35&#10;（寫 - 代表清除）"></textarea>
          <div class="btns"><button type="button" id="pwApply" class="primary">套用</button><span class="spacer"></span><button type="button" id="pwClear" class="danger ghost">清除全部</button></div>
        </details>` : ''}`;
    const q = (id) => box.querySelector('#' + id);
    q('pwOn').onchange = async (e) => {
      await P.setOn(e.target.checked);
      toast(e.target.checked ? '已開啟' : '已關閉');
      draw();
    };
    if (!on) return;
    q('pwAdv').ontoggle = (e) => { S.ui.pwAdv = e.target.open; };
    q('pwGap').onchange = async (e) => { await P.setPowerOpts({ gap: Number(e.target.value) }); toast('已儲存'); };
    q('pwMatch').onchange = async (e) => { await P.setPowerOpts({ match: e.target.checked }); toast('已儲存'); };
    q('pwApply').onclick = async () => {
      const res = await P.bulkApply(q('pwBulk').value, S.regs.flatMap((r) => r.players));
      if (!res.ok && !res.miss.length && !res.bad.length) return toast('沒有可以套用的內容', { type: 'warn' });
      const parts = [`已套用 ${res.ok} 位`];
      if (res.miss.length) parts.push(`找不到 ${res.miss.length} 位（${res.miss.slice(0, 3).join('、')}${res.miss.length > 3 ? '…' : ''}）`);
      if (res.bad.length) parts.push(`${res.bad.length} 行看不懂`);
      toast(parts.join('，'), { type: res.miss.length || res.bad.length ? 'warn' : 'ok', ms: 6000 });
      draw();
    };
    q('pwClear').onclick = async () => {
      if (!P.hasAnyPower()) return toast('目前沒有設定任何選手');
      if (!(await confirmDlg('清除所有選手設定的數字？', { danger: true, ok: '清除' }))) return;
      await P.clearAllPower();
      toast('已清除');
      draw();
    };
  };
  draw();
  modal({ title: '選手列表設定', body: box, buttons: [{ label: '關閉', cls: 'primary' }] });
}
