// admin/page-players.js — 選手列表：每位選手的遊戲名稱、遊戲 ID、Discord、所屬隊伍
// 點選手 → 選手資料（每一項都可以直接修改、複製；也可以打開完整的報名資料）。右上角「⚙ 設定」裡有進階功能，預設關閉；
// 開啟後每位選手資料裡才會多一個「⚙ 設定」，列表本身看起來完全一樣。
import { S, rm, emit, saveRegs, saveTeams, liveBench, benchSet } from './state.js?v=6c54854c';
import { toast, modal, confirmDlg, pageHead } from './ui.js?v=6c54854c';
import { esc } from '../util.js?v=6c54854c';
import { teamLabel, movePlayer, memberInfo } from '../matcher.js?v=6c54854c';
import * as I from '../importer.js?v=6c54854c';
import { openRegDialog } from './page-import.js?v=6c54854c';
import * as P from './power.js?v=6c54854c';

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

// state：team = 在隊伍裡、reg = 還沒組隊（照 3 人報名的隊名）、bench = 無隊伍、none = 尚未分隊
function teamOf(r, t, m, benched) {
  if (t) {
    const n = t.members.length;
    return { state: 'team', text: teamLabel(t, m, 'team'), note: t.include ? '' : n < 3 ? '沒湊滿 3 人' : n > 3 ? `多 ${n - 3} 人` : '不參加抽籤' };
  }
  if (benched) return { state: 'bench', text: '', note: '' };
  if (r.type === 3) return { state: 'reg', text: r.teamName || '', note: r.teamName ? (S.teams.length ? '尚未加入' : '') : '未填隊名' };
  return { state: 'none', text: '', note: '' };
}
const teamWord = (tm) => tm.text || (tm.state === 'bench' ? '無隊伍' : tm.state === 'none' ? '尚未分隊' : '');

function allRows() {
  const m = rm();
  const where = {};
  for (const t of S.teams) t.members.forEach((ref) => { where[`${ref.r}#${ref.i}`] = t; });
  const out = benchSet();
  const rows = [];
  S.regs.forEach((r, ri) => {
    if (r.excluded) return;
    r.players.forEach((p, i) => {
      const t = where[`${r.id}#${i}`] || null;
      rows.push({ r, ri, i, p, t, team: teamOf(r, t, m, out.has(`${r.id}#${i}`)), dc: discordOf(r, i) });
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
  let list = q ? rows.filter((x) => [x.p.nick, x.p.gid, x.dc.text, teamWord(x.team)].join(' ').toLowerCase().includes(q)) : rows.slice();
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
  const { text, note, state } = x.team;
  if (state === 'bench') return dim('無隊伍');
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
    const team = teamWord(x.team);
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
    // 所屬隊伍：只動這一位選手（除非選了交換），其他隊友不受影響
    const label = (t) => teamLabel(t, m(), 'team');
    const benched = x.team.state === 'bench';
    if (!S.teams.length) {
      return `
        <label class="ed-l">所屬隊伍 <select id="edMove">
          <option value="">${x.r.type === 3 ? `照報名（${esc(x.r.teamName || '未填隊名')}）` : '照報名（等隨機媒合）'}</option>
          <option value="__bench" ${benched ? 'selected' : ''}>無隊伍</option>
        </select></label>
        <div class="hint">還沒組隊。設成「無隊伍」的選手，之後「隨機媒合組隊」不會把他分進任何隊伍；組好隊之後，就可以單獨換到別隊。</div>
        <div class="ed-row"><button type="button" class="mini primary" data-ed="save">儲存</button><button type="button" class="mini ghost" data-ed="cancel">取消</button></div>`;
    }
    const cur = x.t ? x.t.id : benched ? '__bench' : '';
    return `
      <label class="ed-l">所屬隊伍 <select id="edMove">
        ${!x.t && !benched ? '<option value="" selected>（還沒分隊）</option>' : ''}
        <option value="__bench" ${cur === '__bench' ? 'selected' : ''}>無隊伍</option>
        ${S.teams.map((y) => `<option value="${esc(y.id)}" ${cur === y.id ? 'selected' : ''}>${esc(label(y))}（${y.members.length} 人${cur === y.id ? '・目前' : y.include ? '' : '・不參加抽籤'}）</option>`).join('')}
      </select></label>
      <div id="edHow" class="ed-how" hidden>
        <label class="chk"><input type="radio" name="edHow" value="alone" checked> <span id="edAlone">單獨加入</span></label>
        <label class="chk"><input type="radio" name="edHow" value="swap"> 跟這隊的 <select id="edSwap"></select> 交換</label>
      </div>
      <div class="hint" id="edMoveHint"></div>
      <div class="hint">隊名要到「選手抽籤」的隊伍卡片上改。</div>
      <div class="ed-row"><button type="button" class="mini primary" data-ed="save">儲存</button><button type="button" class="mini ghost" data-ed="cancel">取消</button></div>`;
  };

  const draw = () => {
    const dc = dcDetail(x);
    box.innerHTML = `
      <dl>
        ${field('nick', '遊戲名稱', `${x.p.nick ? `<span class="name">${esc(x.p.nick)}</span>${copyBtn(x.p.nick)}` : dim('（未填）')}${editBtn('nick')}`)}
        ${field('gid', '遊戲 ID', `${x.p.gid ? `<span class="gid">${esc(x.p.gid)}</span>${copyBtn(x.p.gid)}` : dim('—')}${editBtn('gid')}`)}
        ${field('discord', 'Discord', `${dc.main}${editBtn('discord')}${dc.hint ? `<div class="hint">${dc.hint}</div>` : ''}`)}
        ${field('team', '所屬隊伍', `${teamCell(x)}${x.team.text ? copyBtn(x.team.text) : ''}${editBtn('team')}`)}
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
    if (mv) { mv.onchange = () => onMovePick(); onMovePick(); }
    box.querySelectorAll('input[name="edHow"]').forEach((r) => { r.onchange = () => onMovePick(); });
    const sw = box.querySelector('#edSwap');
    if (sw) sw.onchange = () => { box.querySelector('input[name="edHow"][value="swap"]').checked = true; onMovePick(); };
    const inp = box.querySelector('#edIn');
    if (inp) { inp.focus(); inp.select(); } else if (mv) mv.focus();
  };

  // 選了要去的地方：說明會發生什麼事；對方 3 人以上時可以選「單獨加入」或「交換」
  const onMovePick = () => {
    const mv = box.querySelector('#edMove');
    const hintEl = box.querySelector('#edMoveHint');
    if (!mv || !hintEl) return;
    const v = mv.value;
    const label = (t) => `「${esc(teamLabel(t, m(), 'team'))}」`;
    const target = S.teams.find((y) => y.id === v) || null;
    const same = (x.t && v === x.t.id) || (v === '__bench' && x.team.state === 'bench') || v === '';
    const how = box.querySelector('#edHow');
    const full = target && !same && target.members.length >= 3;
    how.hidden = !full;
    if (full) {
      box.querySelector('#edAlone').textContent = `單獨加入（這隊會變 ${target.members.length + 1} 人，先不參加抽籤，之後再調整）`;
      const sw = box.querySelector('#edSwap');
      if (sw.dataset.team !== target.id) {
        sw.dataset.team = target.id;
        sw.innerHTML = target.members.map((ref, i) => {
          const info = memberInfo(m(), ref);
          return `<option value="${i}">${esc((info && info.nick) || '（未填）')}${i === target.cap ? '（隊長）' : ''}</option>`;
        }).join('');
      }
    }
    const swap = full && box.querySelector('input[name="edHow"]:checked').value === 'swap';
    const notes = [];
    if (!same) {
      if (swap) {
        const other = memberInfo(m(), target.members[Number(box.querySelector('#edSwap').value)] || {});
        notes.push(`${esc((other && other.nick) || '對方')} 會${x.t ? `換到${label(x.t)}` : '變成無隊伍'}，兩隊人數不變。`);
      } else {
        if (x.t) notes.push(`原本的${label(x.t)}會剩 ${x.t.members.length - 1} 人${x.t.include && x.t.members.length === 3 ? '，先不參加抽籤（湊回 3 人會自動回到抽籤名單）' : ''}。`);
        if (target && target.members.length < 3) notes.push(`會加入${label(target)}的空位（變 ${target.members.length + 1} 人）。`);
        if (v === '__bench') notes.push('之後「重新隨機媒合」「補進新報名的選手」都不會把他分進隊伍，要再到這裡選隊伍。');
      }
      if (x.r.type === 2 && x.t) notes.push('這位是 2 人報名，會跟搭檔分開。');
    }
    hintEl.innerHTML = notes.join('<br>');
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
    const v = box.querySelector('#edMove').value;
    const ref = { r: x.r.id, i: x.i };
    const benched = x.team.state === 'bench';
    // 還沒組隊：只有「照報名」和「無隊伍」
    if (!S.teams.length) {
      const want = v === '__bench';
      if (want === benched) return done();
      S.bench = want ? liveBench().concat([ref]) : liveBench().filter((y) => !(y.r === ref.r && y.i === ref.i));
      await saveTeams();
      emit('teams');
      return done(want ? '已設成無隊伍' : '已改回照報名');
    }
    if (v === '' || (x.t && v === x.t.id) || (v === '__bench' && benched)) return done();
    let dest = { bench: true };
    const target = v === '__bench' ? null : S.teams.find((y) => y.id === v);
    if (target) {
      dest = { team: target.id };
      const how = box.querySelector('input[name="edHow"]:checked');
      if (target.members.length >= 3 && how && how.value === 'swap') dest.swap = Number(box.querySelector('#edSwap').value);
    }
    const res = movePlayer(S.teams, liveBench(), ref, dest);
    const label = (t) => `「${teamLabel(t, m(), 'team')}」`;
    const inBr = new Set(S.bracket ? S.bracket.leaves.filter(Boolean) : []);
    const wasIn = (id) => !!(S.teams.find((y) => y.id === id) || {}).include;
    const lost = S.teams.filter((y) => inBr.has(y.id) && y.include && !(res.teams.find((z) => z.id === y.id) || {}).include);
    const gained = S.bracket ? res.teams.filter((z) => z.include && !wasIn(z.id) && !inBr.has(z.id)) : [];
    if (lost.length || gained.length) {
      const parts = [];
      if (lost.length) parts.push(`${lost.map(label).join('、')}換完人數不是 3 人，會先不參加抽籤`);
      if (gained.length) parts.push(`${gained.map(label).join('、')}湊滿 3 人，會回到抽籤名單`);
      if (!(await confirmDlg(`${parts.join('；')}。目前抽好的賽程需要重新抽籤。確定要換嗎？`, { danger: true, ok: '確定' }))) return;
    }
    const before = S.teams;
    S.teams = res.teams;
    S.bench = res.bench;
    await saveTeams();
    emit('teams');
    const notes = [];
    if (x.t) {
      const src = res.teams.find((z) => z.id === x.t.id);
      if (!src) notes.push(`${label(x.t)}已經沒有人`);
      else if (!src.include && x.t.include) notes.push(`${label(src)}剩 ${src.members.length} 人，先不參加抽籤`);
      else if (src.include && !x.t.include) notes.push(`${label(src)}湊回 3 人，回到抽籤名單`);
    }
    if (target && dest.swap == null) {
      const tg = res.teams.find((z) => z.id === target.id);
      if (tg && tg.members.length > 3) notes.push(`${label(tg)}現在 ${tg.members.length} 人，先不參加抽籤`);
      else if (tg && tg.include && !target.include) notes.push(`${label(tg)}湊滿 3 人，回到抽籤名單`);
      else if (tg && tg.members.length === 3 && !tg.include) notes.push(`${label(tg)}滿 3 人了，要參加抽籤請到「選手抽籤」勾選`);
    }
    if (target && dest.swap != null && !x.t) {
      const other = memberInfo(rm(), (before.find((z) => z.id === target.id) || { members: [] }).members[dest.swap] || {});
      notes.push(`${(other && other.nick) || '對方'} 變成無隊伍`);
    }
    const msg = dest.bench ? '已設成無隊伍' : dest.swap != null ? '已交換' : '已換隊';
    return done(`${msg}${notes.length ? `（${notes.join('；')}）` : ''}`, notes.length ? 'warn' : undefined);
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
      { label: '完整報名資料', cls: 'ghost', onClick: (close) => {
        close();
        const reg = S.regs.find((y) => y.id === x.r.id) || x.r;
        // 儲存、返回都回到這位選手的資料（存檔後如果這位選手已經不在列表裡，例如改成不列入，就停在列表）
        openRegDialog(reg, () => render(main), { back: () => { const y = allRows().find((z) => rowKey(z) === key); if (y) openPlayer(main, y); } });
      } },
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
