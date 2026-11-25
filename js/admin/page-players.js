// admin/page-players.js — 選手列表：每位選手的遊戲名稱、遊戲 ID、Discord、所屬隊伍
// 點選手 → 選手資料（每一項都可以直接修改、複製；也可以打開完整的報名資料）。右上角「⚙ 設定」裡有進階功能，預設關閉；
// 開啟後每位選手資料裡才會多一個「⚙ 設定」，列表本身看起來完全一樣。
import { S, rm, emit, saveRegs, saveTeams } from './state.js?v=108fb9d5';
import { toast, modal, confirmDlg, pageHead } from './ui.js?v=108fb9d5';
import { esc } from '../util.js?v=108fb9d5';
import { teamLabel, swapMembers } from '../matcher.js?v=108fb9d5';
import * as I from '../importer.js?v=108fb9d5';
import { openRegDialog } from './page-import.js?v=108fb9d5';
import * as P from './power.js?v=108fb9d5';

const COLS = [['nick', '遊戲名稱'], ['gid', '遊戲 ID'], ['discord', 'Discord'], ['team', '所屬隊伍']];
const dim = (t) => `<span class="dim">${t}</span>`;
const W = '\u6230\u529b'; // 只在兩個「⚙ 設定」裡面顯示的字
const rowKey = (x) => `${x.r.id}#${x.i}`;

// Discord：表單每筆報名只有一個（報名者填的），放在那筆報名的第一位選手（3 人隊 = 隊長、2 人 = 隊員 A）；
// 其他隊友可以在選手資料裡另外填自己的（存在 players[i].discord）
function discordOf(r, i) {
  if (i > 0) { const own = r.players[i] && r.players[i].discord; return own ? { kind: 'own', text: own } : { kind: 'mate', text: '' }; }
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

// 選手資料裡 Discord 那一格：主要的值（後面接按鈕）＋說明
function dcDetail(x) {
  const r = x.r;
  const { kind, text } = x.dc;
  if (kind === 'own') return { main: `<span class="dc">${esc(text)}</span>${copyBtn(text)}`, hint: x.i === 0 && r.players.length > 1 ? '這筆報名填的聯絡 Discord' : '' };
  if (kind === 'missing') return { main: dim('未填'), hint: '報名時選了 Discord，但沒有填使用者名稱' };
  if (kind === 'none') return { main: dim('沒有 Discord'), hint: '聯絡方式：遊戲內好友' };
  if (kind === 'mate') {
    const who = r.players[0] && r.players[0].nick;
    return { main: dim('—'), hint: r.discord ? `同一筆報名只填了一個 Discord：<b>${esc(r.discord)}</b>${who ? `（${esc(who)}）` : ''}${copyBtn(r.discord)}` : '' };
  }
  return { main: dim('—'), hint: '' };
}

const editBtn = (f) => ` <button type="button" class="mini ghost" data-edit="${f}">✎ 修改</button>`;

// ── 選手資料：每一項都可以直接修改（一次改一項，Enter 儲存、Esc 取消）──
function openPlayer(main, x0) {
  const key = rowKey(x0);
  let x = x0;
  let editing = null;
  const box = document.createElement('div');
  box.className = 'pl-info';
  const refresh = () => { x = allRows().find((y) => rowKey(y) === key) || x; };
  const m = () => rm();
  const teamEditable = () => !!x.t || x.r.type === 3;

  const field = (f, label, view) => `<dt>${label}</dt><dd data-f="${f}" class="${editing === f ? 'editing' : ''}">${editing === f ? editor(f) : view}</dd>`;
  const textEditor = (value, attrs, hint) => `
    <div class="ed-row"><input id="edIn" value="${esc(value)}" ${attrs}><button type="button" class="mini primary" data-ed="save">儲存</button><button type="button" class="mini ghost" data-ed="cancel">取消</button></div>
    ${hint ? `<div class="hint">${hint}</div>` : ''}`;
  const editor = (f) => {
    if (f === 'nick') return textEditor(x.p.nick || '', 'placeholder="遊戲名稱" maxlength="40"', '');
    if (f === 'gid') return textEditor(x.p.gid || '', 'placeholder="遊戲 ID（數字）" inputmode="numeric" maxlength="20"', '');
    if (f === 'discord') {
      const mine = x.i === 0 ? x.r.discord || '' : (x.p.discord || '');
      const hint = x.i === 0
        ? (x.r.players.length > 1 ? '這是這筆報名填的聯絡 Discord（使用者名稱，不是顯示名稱）' : 'Discord 的使用者名稱（不是顯示名稱）')
        : `這位選手自己的 Discord${x.r.discord ? `（同一筆報名填的是 ${esc(x.r.discord)}）` : ''}；留空 = 沒有`;
      return textEditor(mine, 'placeholder="Discord 使用者名稱" maxlength="40"', hint);
    }
    // 所屬隊伍
    const t = x.t;
    const cur = t ? t.name || '' : x.r.teamName || '';
    const ph = t ? teamLabel(Object.assign({}, t, { name: '' }), m(), 'team') : '隊伍名稱';
    const others = t ? S.teams.filter((y) => y.id !== t.id) : [];
    const mates = t ? Math.max(0, t.members.length - 1) : Math.max(0, x.r.players.length - 1);
    return `
      <label class="ed-l">隊名 <input id="edName" value="${esc(cur)}" placeholder="${esc(ph)}" maxlength="40"></label>
      <div class="hint">${mates ? `同隊的 ${mates} 位選手會一起改。` : ''}${t ? '' : '還沒組隊，改的是報名時填的隊名。'}</div>
      ${others.length ? `
        <label class="ed-l">換到 <select id="edMove"><option value="">（不換隊）</option>${others.map((y) => `<option value="${esc(y.id)}">${esc(teamLabel(y, m(), 'team'))}（${y.members.length} 人${y.include ? '' : '，不參加抽籤'}）</option>`).join('')}</select></label>
        <label class="ed-l" id="edSwapL" hidden>跟誰交換 <select id="edSwap"></select></label>
        <div class="hint" id="edMoveHint"></div>` : ''}
      <div class="ed-row"><button type="button" class="mini primary" data-ed="save">儲存</button><button type="button" class="mini ghost" data-ed="cancel">取消</button></div>`;
  };

  const draw = () => {
    const dc = dcDetail(x);
    box.innerHTML = `
      <dl>
        ${field('nick', '遊戲名稱', `${x.p.nick ? `<span class="name">${esc(x.p.nick)}</span>${copyBtn(x.p.nick)}` : dim('（未填）')}${editBtn('nick')}`)}
        ${field('gid', '遊戲 ID', `${x.p.gid ? `<span class="gid">${esc(x.p.gid)}</span>${copyBtn(x.p.gid)}` : dim('—')}${editBtn('gid')}`)}
        ${field('discord', 'Discord', `${dc.main}${editBtn('discord')}${dc.hint ? `<div class="hint">${dc.hint}</div>` : ''}`)}
        ${field('team', '所屬隊伍', `${teamCell(x)}${x.team.text ? copyBtn(x.team.text) : ''}${teamEditable() ? editBtn('team') : ''}`)}
      </dl>
      ${P.isOn() ? '<div class="pi-more"><button type="button" class="ghost" id="piSetBtn">⚙ 設定</button><div class="pi-set" id="piSet" hidden></div></div>' : ''}`;
    const btn = box.querySelector('#piSetBtn');
    if (btn) btn.onclick = () => {
      const el = box.querySelector('#piSet');
      el.hidden = !el.hidden;
      btn.classList.toggle('on', !el.hidden);
      if (!el.hidden) drawSet(el);
    };
    const mv = box.querySelector('#edMove');
    if (mv) mv.onchange = () => onMovePick();
    const inp = box.querySelector('#edIn') || box.querySelector('#edName');
    if (inp) { inp.focus(); inp.select(); }
  };

  // 選了要換去的隊伍：滿 3 人就要選跟誰交換；換隊時不能同時改隊名
  const onMovePick = () => {
    const id = box.querySelector('#edMove').value;
    const target = S.teams.find((y) => y.id === id);
    const swapL = box.querySelector('#edSwapL');
    const name = box.querySelector('#edName');
    name.disabled = !!target;
    swapL.hidden = !(target && target.members.length >= 3);
    if (target && target.members.length >= 3) {
      box.querySelector('#edSwap').innerHTML = `<option value="">（請選擇）</option>${target.members.map((ref, i) => {
        const r = m()[ref.r];
        const nick = (r && r.players[ref.i] && r.players[ref.i].nick) || '（未填）';
        return `<option value="${i}">${esc(nick)}${i === target.cap ? '（隊長）' : ''}</option>`;
      }).join('')}`;
    }
    const notes = [];
    if (target) {
      if (target.members.length < 3) notes.push(`會移到 ${esc(teamLabel(target, m(), 'team'))} 的空位，原本的隊伍會少一個人。`);
      if (x.r.type === 2) notes.push('這位是 2 人報名，換隊會跟搭檔分開。');
      if (x.t && x.t.origin === 'self') notes.push('這是自己組的隊伍，換隊後原本的隊伍會拆開。');
    }
    box.querySelector('#edMoveHint').innerHTML = notes.join('<br>');
  };

  const done = (msg, type) => {
    editing = null;
    refresh();
    render(main);
    draw();
    if (msg) toast(msg, type ? { type } : undefined);
  };

  const saveText = async (f) => {
    let v = box.querySelector('#edIn').value.trim();
    if (f === 'gid') {
      v = I.normGid(v);
      if (v && !/^\d+$/.test(v)) { toast('遊戲 ID 只能是數字', { type: 'warn' }); return; }
    }
    if (f === 'nick' && !v) { toast('遊戲名稱不能空白', { type: 'warn' }); return; }
    const r0 = S.regs.find((y) => y.id === x.r.id);
    if (!r0) return done();
    const old = f === 'discord' ? (x.i === 0 ? r0.discord || '' : r0.players[x.i].discord || '') : r0.players[x.i][f] || '';
    if (v === old) return done();
    const nr = JSON.parse(JSON.stringify(r0));
    const np = nr.players[x.i];
    if (f === 'discord') {
      if (x.i === 0) nr.discord = v;
      else if (v) np.discord = v;
      else delete np.discord;
    } else np[f] = v;
    if (nr.src !== 'manual') nr.edited = true;
    S.regs = S.regs.map((y) => (y.id === nr.id ? nr : y));
    await saveRegs();
    if (f !== 'discord') await P.movePowerKey(r0.players[x.i], np, S.regs.flatMap((y) => y.players.filter((_, i) => !(y.id === nr.id && i === x.i))));
    emit('regs');
    if (f === 'gid' && v) {
      const dup = S.regs.filter((y) => !y.excluded).flatMap((y) => y.players.map((q, i) => ({ q, me: y.id === nr.id && i === x.i }))).find((o) => !o.me && o.q.gid === v);
      if (dup) return done(`已儲存（這個 ID 跟「${dup.q.nick || '另一位選手'}」重複）`, 'warn');
    }
    done('已儲存');
  };

  const saveTeam = async () => {
    const t = x.t;
    const mv = box.querySelector('#edMove');
    const target = mv && mv.value ? S.teams.find((y) => y.id === mv.value) : null;
    if (target && t) {
      const from = { team: t.id, idx: t.members.findIndex((ref) => ref.r === x.r.id && ref.i === x.i) };
      let to = { team: target.id, idx: target.members.length };
      if (target.members.length >= 3) {
        const sv = box.querySelector('#edSwap').value;
        if (sv === '') { toast('請選擇要跟誰交換', { type: 'warn' }); return; }
        to = { team: target.id, idx: Number(sv) };
      }
      const next = swapMembers(S.teams, from, to);
      const inBr = new Set(S.bracket ? S.bracket.leaves.filter(Boolean) : []);
      const lost = S.teams.filter((y) => inBr.has(y.id) && y.include && !(next.find((z) => z.id === y.id) || {}).include);
      if (lost.length && !(await confirmDlg(`${lost.map((y) => `「${teamLabel(y, m(), 'team')}」`).join('、')}換完會不滿 3 人、不再參加抽籤，目前的賽程需要重新抽籤。確定要換嗎？`, { danger: true, ok: '換隊' }))) return;
      S.teams = next;
      await saveTeams();
      emit('teams');
      const notes = [];
      const src = next.find((z) => z.id === t.id);
      if (!src) notes.push(`「${teamLabel(t, m(), 'team')}」已經沒有人`);
      else if (!src.include && t.include) notes.push(`「${teamLabel(src, m(), 'team')}」剩 ${src.members.length} 人，不參加抽籤`);
      const tg = next.find((z) => z.id === target.id);
      if (tg && tg.members.length === 3 && !tg.include) notes.push(`「${teamLabel(tg, m(), 'team')}」滿 3 人了，要參加抽籤請到「選手抽籤」勾選`);
      return done(`已換隊${notes.length ? `（${notes.join('；')}）` : ''}`, notes.length ? 'warn' : undefined);
    }
    const name = box.querySelector('#edName').value.trim();
    if (t) {
      if (name === (t.name || '')) return done();
      S.teams = S.teams.map((y) => (y.id === t.id ? Object.assign({}, y, { name, autoName: false }) : y));
      // 自己組的隊伍：報名資料上的隊名也一起改（之後重新媒合、重新組隊都會沿用）
      const own = t.origin === 'self' && t.members[0] ? S.regs.find((y) => y.id === t.members[0].r && y.type === 3) : null;
      if (own && own.teamName !== name) {
        S.regs = S.regs.map((y) => (y.id === own.id ? Object.assign({}, y, { teamName: name }, y.src !== 'manual' ? { edited: true } : {}) : y));
        await saveRegs();
        emit('regs');
      }
      await saveTeams();
      emit('teams');
      return done('已儲存');
    }
    if (name === (x.r.teamName || '')) return done();
    S.regs = S.regs.map((y) => (y.id === x.r.id ? Object.assign({}, y, { teamName: name }, y.src !== 'manual' ? { edited: true } : {}) : y));
    await saveRegs();
    emit('regs');
    done('已儲存');
  };

  const save = async () => {
    const f = editing;
    if (!f) return;
    box.querySelectorAll('[data-ed]').forEach((b) => { b.disabled = true; });
    try {
      if (f === 'team') await saveTeam(); else await saveText(f);
    } finally {
      box.querySelectorAll('[data-ed]').forEach((b) => { b.disabled = false; });
    }
  };

  box.onclick = (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) return copy(c.dataset.copy);
    const ed = e.target.closest('[data-edit]');
    if (ed) { editing = ed.dataset.edit; draw(); return; }
    const act = e.target.closest('[data-ed]');
    if (act) { if (act.dataset.ed === 'save') save(); else { editing = null; draw(); } }
  };
  box.onkeydown = (e) => {
    if (!editing || !e.target.closest('dd.editing')) return;
    if (e.key === 'Escape') { e.stopPropagation(); editing = null; draw(); }
    else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
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
    const savePw = async (val) => {
      if (!(await P.setPlayerPower(x.p, val))) { toast('這位選手沒有遊戲 ID 也沒有名稱，沒辦法設定', { type: 'warn' }); return; }
      toast(val == null ? '已清除' : '已儲存');
      drawSet(el);
    };
    el.querySelector('#piSave').onclick = () => {
      const n = P.parseValue(num.value);
      if (n == null) { toast(`請輸入 0～${P.MAX} 的數字`, { type: 'warn' }); num.focus(); return; }
      savePw(n);
    };
    num.onkeydown = (e) => { if (e.key === 'Enter') el.querySelector('#piSave').click(); };
    el.querySelector('#piClear').onclick = () => savePw(null);
  };

  draw();
  modal({
    title: '選手資料',
    body: box,
    buttons: [
      { label: '完整報名資料', cls: 'ghost', onClick: (close) => { close(); openRegDialog(x.r, () => render(main)); } },
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
