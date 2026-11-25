// admin/page-import.js — 表單匯入：Excel／CSV、Google 表單同步、手動新增、統計與完整資料表
import { S, saveRegs, saveSync, saveRoster, snapshot, emit } from './state.js?v=2628f905';
import * as I from '../importer.js?v=2628f905';
import { esc, fmtDateTime, uid } from '../util.js?v=2628f905';
import { toast, modal, confirmDlg, busy, pageHead } from './ui.js?v=2628f905';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let XLSX = null;
async function loadXLSX() {
  if (!XLSX) {
    try { XLSX = await import(XLSX_URL); } catch (e) {
      throw new Error('Excel 讀取元件載入失敗（需要網路）。也可以在 Google 試算表選「檔案 → 下載 → CSV」後匯入 CSV。');
    }
  }
  return XLSX;
}

export async function readFile(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (/\.(csv|tsv|txt)$/.test(name)) {
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('big5').decode(buf); }
    return [{ name: file.name, rows: I.parseCSV(text) }];
  }
  const X = await loadXLSX();
  return I.sheetsFromWorkbook(X, buf);
}

const TYPE_TEXT = { 3: '3 人隊伍', 2: '2 人報名', 1: '1 人報名' };

export function rosterTag(gid) {
  if (!S.roster || !gid) return '';
  const hit = S.roster.byGid[gid];
  if (!hit) return '<span class="tag warn" title="玩家名冊裡找不到這個 ID">名冊無此 ID</span>';
  const label = hit.common || hit.name || '名冊';
  return `<span class="tag ok" title="${esc(`名冊：${hit.name || ''}${hit.alt ? '（小號）' : ''}${hit.region ? '｜現居 ' + hit.region : ''}${hit.note ? '｜' + hit.note : ''}`)}">${esc(label)}${hit.region ? '・' + esc(hit.region) : ''}</span>`;
}

export function render(main) {
  const st = I.regStats(S.regs);
  let rosterHit = 0, rosterMiss = 0;
  if (S.roster) {
    for (const r of S.regs) if (!r.excluded) for (const p of r.players) if (p.gid) (S.roster.byGid[p.gid] ? rosterHit++ : rosterMiss++);
  }
  const lastSync = S.sync && S.sync.last ? fmtDateTime(S.sync.last) : '尚未同步';
  main.innerHTML = `
    ${pageHead('表單匯入', 'import')}
    <p class="lead">匯入 Excel／CSV，或直接同步 Google 表單的回覆。資料會自動統計，並整理出每筆報名的隊伍名稱、隊長、隊員與聯絡資料；顯示屏與抽籤都使用這裡的資料。</p>
    <section class="card" id="impStats">
      <div class="stats">
        <div class="stat"><b>${st.total}</b><span>報名筆數</span></div>
        <div class="stat"><b>${st.t3}</b><span>3 人隊伍</span></div>
        <div class="stat"><b>${st.t2}</b><span>2 人報名</span></div>
        <div class="stat"><b>${st.t1}</b><span>1 人報名</span></div>
        <div class="stat"><b>${st.players}</b><span>選手總數</span></div>
        <div class="stat"><b>${st.canTeams}</b><span>可組成隊伍（估）</span></div>
        <div class="stat"><b>${st.discord}</b><span>用 Discord 聯絡</span></div>
        <div class="stat"><b>${st.dcJoined}</b><span>已加入 DC 群組</span></div>
        <div class="stat ${st.flagged ? 'warn' : ''}"><b>${st.flagged}</b><span>需要確認</span></div>
        ${S.roster ? `<div class="stat"><b>${rosterHit}/${rosterHit + rosterMiss}</b><span>名冊比對到的選手</span></div>` : ''}
      </div>
      ${st.leftPairs || st.leftSingles ? `<p class="hint">媒合後預計還會剩：${st.leftPairs ? `${st.leftPairs} 組 2 人報名缺 1 人` : ''}${st.leftPairs && st.leftSingles ? '、' : ''}${st.leftSingles ? `${st.leftSingles} 位 1 人報名` : ''}。</p>` : ''}
    </section>
    <section class="card" id="impSrc">
      <h3>匯入資料</h3>
      <div class="drop" id="drop">
        <div>把 Excel（.xlsx / .xls）或 CSV 檔拖到這裡</div>
        <button id="pick" class="primary">選擇檔案</button>
        <input type="file" id="file" accept=".xlsx,.xls,.csv,.tsv,.txt" hidden>
      </div>
      <p class="hint">Google 表單的回覆試算表：<b>檔案 → 下載 → Microsoft Excel (.xlsx)</b> 或 CSV。SurveyCake 匯出的 Excel、自己整理的 Excel（隊伍名稱／隊長／隊員欄）也可以，匯入前可以手動調整欄位對應。</p>
      <div class="btns">
        <button id="gsync" class="primary">🔄 從 Google 表單同步</button>
        <button id="gset" class="ghost">同步設定</button>
        <span class="hint">上次同步：${esc(lastSync)}</span>
      </div>
      <div class="btns">
        <button id="addReg">＋ 手動新增報名</button>
        <button id="exportCsv" class="ghost" ${S.regs.length ? '' : 'disabled'}>匯出 CSV 備份</button>
        <button id="clearRegs" class="ghost" ${S.regs.length ? '' : 'disabled'}>清空報名資料</button>
      </div>
    </section>
    <section class="card" id="impRoster">
      <h3>玩家名冊比對（選用）</h3>
      <p class="hint">匯入「狂想之息玩家名字紀錄表」這類名冊（要有「遊戲ID」欄），報名資料會用遊戲 ID 比對，顯示常用稱呼與現居地，找不到的會標示「名冊無此 ID」。</p>
      <div class="btns">
        <button id="rosterPick">匯入名冊檔案</button>
        <input type="file" id="rosterFile" accept=".xlsx,.xls,.csv" hidden>
        ${S.roster ? `<span class="hint">目前名冊：${S.roster.count} 筆（${esc(S.roster.file || '')}，${esc(fmtDateTime(S.roster.at))}）</span><button id="rosterClear" class="ghost">清除名冊</button>` : '<span class="hint">尚未匯入名冊</span>'}
      </div>
    </section>
    <section class="card" id="impList">
      <h3>完整報名資料（${S.regs.length} 筆）</h3>
      <div class="inline">
        <input id="q" placeholder="搜尋隊伍、暱稱、ID、Discord…" value="${esc(S.ui.impQuery || '')}" style="flex:1;min-width:220px">
        <div class="seg" id="flt">
          ${[['all', '全部'], ['3', '3 人'], ['2', '2 人'], ['1', '1 人'], ['flag', '需要確認'], ['excluded', '不列入']].map(([v, l]) => `<button data-f="${v}" class="${(S.ui.impFilter || 'all') === v ? 'on' : ''}">${l}</button>`).join('')}
        </div>
      </div>
      <div class="tbl-wrap"><table class="tbl" id="tbl"></table></div>
    </section>`;

  const $ = (id) => main.querySelector('#' + id);
  drawTable(main);
  $('q').addEventListener('input', () => { S.ui.impQuery = $('q').value; drawTable(main); });
  $('flt').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    S.ui.impFilter = b.dataset.f;
    $('flt').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    drawTable(main);
  });
  $('tbl').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openRegDialog(S.regs.find((r) => r.id === tr.dataset.id), () => render(main));
  });

  // 檔案
  const drop = $('drop');
  $('pick').onclick = () => $('file').click();
  $('file').onchange = () => { const f = $('file').files[0]; $('file').value = ''; if (f) handleFile(f, main); };
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f, main);
  });

  $('gsync').onclick = () => doSync($('gsync'), main);
  $('gset').onclick = () => openSyncSettings(main);
  $('addReg').onclick = () => openRegDialog(null, () => render(main));
  $('exportCsv').onclick = exportCsv;
  $('clearRegs').onclick = async () => {
    if (!(await confirmDlg(`清空全部 ${S.regs.length} 筆報名資料？（會先自動備份，可以在「重置」頁的還原紀錄找回）`, { danger: true, ok: '清空' }))) return;
    await snapshot('清空報名資料前');
    S.regs = [];
    await saveRegs();
    emit('regs');
    toast('已清空報名資料');
    render(main);
  };
  $('rosterPick').onclick = () => $('rosterFile').click();
  $('rosterFile').onchange = async () => {
    const f = $('rosterFile').files[0];
    $('rosterFile').value = '';
    if (!f) return;
    try {
      const sheets = await readFile(f);
      let ro = null;
      for (const sh of sheets) { ro = I.parseRoster(sh.rows); if (ro && ro.count) break; }
      if (!ro || !ro.count) return toast('這個檔案找不到「遊戲ID」欄位', { type: 'err' });
      S.roster = Object.assign(ro, { at: Date.now(), file: f.name });
      await saveRoster();
      toast(`名冊已匯入：${ro.count} 位玩家`);
      render(main);
    } catch (e) { toast(e.message, { type: 'err', ms: 7000 }); }
  };
  if ($('rosterClear')) $('rosterClear').onclick = async () => { S.roster = null; await saveRoster(); render(main); };
}

function drawTable(main) {
  const tbl = main.querySelector('#tbl');
  const q = (S.ui.impQuery || '').trim().toLowerCase();
  const f = S.ui.impFilter || 'all';
  const rows = S.regs.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (f === 'excluded') { if (!r.excluded) return false; }
    else if (f !== 'all' && r.excluded) return false;
    if (f === '3' || f === '2' || f === '1') { if (String(r.type) !== f) return false; }
    if (f === 'flag' && !(r.flags && r.flags.length)) return false;
    if (!q) return true;
    const hay = [r.teamName, r.discord, r.note, r.contact, ...r.players.flatMap((p) => [p.nick, p.gid])].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!S.regs.length) {
    tbl.innerHTML = '<tbody><tr><td class="empty">還沒有報名資料。匯入 Excel／CSV、同步 Google 表單或手動新增。</td></tr></tbody>';
    return;
  }
  tbl.innerHTML = `<thead><tr><th>#</th><th>報名時間</th><th>類型</th><th>隊伍名稱</th><th>選手（★ 隊長）</th><th>聯絡方式</th><th>DC 群組</th><th>備註</th><th>狀態</th></tr></thead>
  <tbody>${rows.map(({ r, i }) => `<tr data-id="${esc(r.id)}" class="${r.excluded ? 'excluded' : ''}">
    <td>${i + 1}</td>
    <td class="nowrap">${esc(r.tsText || fmtDateTime(r.ts))}</td>
    <td><span class="tag t${r.type}">${TYPE_TEXT[r.type]}</span></td>
    <td>${esc(r.teamName) || (r.type === 1 ? '<span class="dim">—</span>' : '<span class="dim">（未填）</span>')}</td>
    <td>${r.players.map((p, pi) => `<div class="pl">${r.capIdx === pi && r.type !== 1 ? '<b class="cap">★</b>' : ''}${esc(p.nick) || '<span class="dim">（未填）</span>'} <span class="gid">${esc(p.gid)}</span> ${rosterTag(p.gid)}</div>`).join('')}${r.type === 2 && r.capIdx == null ? '<div class="dim sm">隊長未定</div>' : ''}</td>
    <td>${esc(r.contact)}${r.discord ? `<div class="sm">${esc(r.discord)}</div>` : ''}</td>
    <td>${esc(r.dc)}</td>
    <td class="note">${esc(r.note)}</td>
    <td>${r.excluded ? '<span class="tag dim">不列入</span>' : ''}${(r.flags || []).map((x) => `<span class="tag warn">${esc(I.FLAG_TEXT[x] || x)}</span>`).join('')}${r.edited ? '<span class="tag">已手動修改</span>' : ''}<span class="tag src">${{ google: 'Google', excel: '檔案', manual: '手動' }[r.src] || r.src}</span></td>
  </tr>`).join('')}</tbody>`;
}

async function handleFile(file, main) {
  try {
    const sheets = await readFile(file);
    if (!sheets.length) return toast('檔案裡沒有資料', { type: 'err' });
    openImportDialog(sheets, file.name, main);
  } catch (e) {
    console.error(e);
    toast(e.message || '讀取失敗', { type: 'err', ms: 7000 });
  }
}

function openImportDialog(sheets, fileName, main) {
  let si = 0, header = 0, map = {};
  const setSheet = (i) => {
    si = i;
    const rows = sheets[i].rows;
    header = I.findHeaderRow(rows);
    map = I.detectMapping((rows[header] || []).map((x) => String(x == null ? '' : x)));
  };
  const best = sheets.findIndex((sh) => Object.keys(I.detectMapping((sh.rows[I.findHeaderRow(sh.rows)] || []).map((x) => String(x == null ? '' : x)))).length >= 3);
  setSheet(best >= 0 ? best : 0);
  const box = document.createElement('div');
  const draw = () => {
    const rows = sheets[si].rows;
    const headers = (rows[header] || []).map((x) => String(x == null ? '' : x));
    const res = I.normalizeRows(rows, map, { src: 'excel', header });
    I.checkRegs(res.regs);
    const st = I.regStats(res.regs);
    const opt = (sel) => `<option value="">（不使用）</option>` + headers.map((h, i) => `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h || `第 ${i + 1} 欄`)}</option>`).join('');
    box.innerHTML = `
      ${sheets.length > 1 ? `<label>工作表 <select id="sheet">${sheets.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${esc(s.name)}（${s.rows.length} 列）</option>`).join('')}</select></label>` : ''}
      <p>${I.looksLikeGoogleForm(map) ? '✅ 偵測到「狂想之息報名表」的 Google 表單格式，欄位已自動對應。' : '已依欄位標題自動對應，請確認下面的對應是否正確。'}</p>
      <details ${I.looksLikeGoogleForm(map) ? '' : 'open'}><summary>欄位對應（${Object.keys(map).length} / ${I.FIELDS.length}）</summary>
        <div class="map-grid">${I.FIELDS.map(([f, label]) => `<label><span>${esc(label)}</span><select data-f="${f}">${opt(map[f])}</select></label>`).join('')}</div>
      </details>
      <p class="sum">共 <b>${res.regs.length}</b> 筆報名：3 人 ${st.t3}、2 人 ${st.t2}、1 人 ${st.t1}（${st.players} 位選手）${res.skipped ? `；略過 ${res.skipped} 列沒有選手資料的列` : ''}${st.flagged ? `；<span class="warnc">${st.flagged} 筆需要確認</span>` : ''}</p>
      <div class="tbl-wrap small"><table class="tbl"><thead><tr><th>類型</th><th>隊伍名稱</th><th>選手</th><th>聯絡</th><th>狀態</th></tr></thead><tbody>
        ${res.regs.slice(0, 8).map((r) => `<tr><td>${TYPE_TEXT[r.type]}</td><td>${esc(r.teamName)}</td><td>${r.players.map((p) => `${esc(p.nick)} <span class="gid">${esc(p.gid)}</span>`).join('、')}</td><td>${esc(r.contact)}</td><td>${(r.flags || []).map((x) => `<span class="tag warn">${esc(I.FLAG_TEXT[x])}</span>`).join('')}</td></tr>`).join('')}
        ${res.regs.length > 8 ? `<tr><td colspan="5" class="dim">…還有 ${res.regs.length - 8} 筆</td></tr>` : ''}
      </tbody></table></div>
      ${S.regs.length ? `<p class="hint">目前已有 ${S.regs.length} 筆。「合併」會略過同類型、同一組遊戲 ID 的重複報名；「取代」會先自動備份再換成這個檔案的資料。</p>` : ''}`;
    const sh = box.querySelector('#sheet');
    if (sh) sh.onchange = () => { setSheet(Number(sh.value)); draw(); };
    box.querySelectorAll('select[data-f]').forEach((s) => {
      s.onchange = () => {
        const v = s.value === '' ? null : Number(s.value);
        if (v == null) delete map[s.dataset.f]; else map[s.dataset.f] = v;
        draw();
      };
    });
    return res;
  };
  draw();
  const doImport = async (mode) => {
    const res = I.normalizeRows(sheets[si].rows, map, { src: 'excel', header });
    if (!res.regs.length) { toast('沒有可匯入的報名資料，請檢查欄位對應', { type: 'warn' }); return false; }
    if (S.regs.length) await snapshot(mode === 'replace' ? '匯入（取代）前' : '匯入（合併）前');
    let msg;
    if (mode === 'replace' || !S.regs.length) {
      S.regs = res.regs;
      msg = `已匯入 ${res.regs.length} 筆報名`;
    } else {
      const m = I.mergeRegs(S.regs, res.regs);
      S.regs = m.list;
      msg = `已新增 ${m.added} 筆${m.dup ? `，略過重複 ${m.dup} 筆` : ''}`;
    }
    await saveRegs();
    emit('regs');
    toast(msg + (S.teams.length ? '。報名有變動時，記得到「選手抽籤」補進新選手。' : ''), { ms: 5000 });
    render(main);
  };
  modal({
    title: `確認匯入：${fileName}`,
    body: box,
    wide: true,
    buttons: [
      { label: '取消', cls: 'ghost' },
      ...(S.regs.length ? [{ label: '合併（略過重複）', onClick: () => doImport('merge') }] : []),
      { label: S.regs.length ? '取代全部資料' : '匯入', cls: 'primary', onClick: () => doImport('replace') },
    ],
  });
}

// ── Google 表單同步 ──
async function fetchSync(url, key) {
  const u = `${url.trim()}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key.trim())}&t=${Date.now()}`;
  let res;
  try { res = await fetch(u, { method: 'GET', redirect: 'follow' }); } catch (e) {
    throw new Error('連不到同步網址。請確認網址是 Apps Script「網頁應用程式」的網址，而且存取權設成「所有人」。');
  }
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('同步網址回傳的不是資料（可能是部署設定或網址錯誤）。'); }
  if (!json.ok) throw new Error(json.error === 'unauthorized' ? '同步金鑰不正確' : (json.error || '同步失敗'));
  return json;
}

async function doSync(btn, main) {
  if (!S.sync || !S.sync.url || !S.sync.key) return openSyncSettings(main);
  busy(btn, true, '同步中…');
  try {
    const json = await fetchSync(S.sync.url, S.sync.key);
    const { rows, ids } = I.rowsFromSync(json);
    const map = I.detectMapping(rows[0].map(String));
    const { regs } = I.normalizeRows(rows, map, { src: 'google', ids });
    const r = I.applySync(S.regs, regs);
    if (r.added || S.regs.some((x) => x.src === 'google')) await snapshot('Google 同步前');
    S.regs = r.list;
    S.sync = Object.assign({}, S.sync, { last: Date.now(), count: regs.length, form: json.form || '' });
    await saveRegs();
    await saveSync();
    emit('regs');
    toast(`同步完成：Google 表單共 ${regs.length} 筆回覆，新增 ${r.added} 筆`, { ms: 5000 });
    render(main);
  } catch (e) {
    toast('同步失敗：' + e.message, { type: 'err', ms: 8000 });
  } finally {
    busy(btn, false);
  }
}

function openSyncSettings(main) {
  const s = S.sync || {};
  modal({
    title: 'Google 表單同步設定',
    wide: true,
    body: `
      <ol class="steps-list">
        <li>打開 Google Apps Script 專案「<b>狂想之息報名表產生器</b>」，確認左邊有「<b>賽程表同步.gs</b>」檔案（沒有的話新增一個，貼上專案資料夾 <code>apps-script/賽程表同步.gs</code> 的內容）。</li>
        <li>上方函式選單選 <code>setupBracketSync</code> → 按 ▷ 執行 → 下方「執行紀錄」會出現<b>同步金鑰</b>。</li>
        <li>右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署，複製「網頁應用程式網址」。</li>
        <li>把網址與金鑰貼到下面，按「測試連線」，成功後儲存。</li>
      </ol>
      <p class="hint">金鑰只存在後台的私人資料區，前台看不到；沒有金鑰的人打開網址只會得到「unauthorized」。</p>
      <label>網頁應用程式網址<input id="sUrl" value="${esc(s.url || '')}" placeholder="https://script.google.com/macros/s/……/exec"></label>
      <label>同步金鑰<input id="sKey" value="${esc(s.key || '')}" placeholder="執行 setupBracketSync 後顯示的金鑰"></label>
      <p id="sMsg" class="hint"></p>`,
    buttons: [
      { label: '取消', cls: 'ghost' },
      { label: '測試連線', onClick: async (close, dlg) => {
        const msg = dlg.querySelector('#sMsg');
        msg.textContent = '測試中…';
        try {
          const j = await fetchSync(dlg.querySelector('#sUrl').value, dlg.querySelector('#sKey').value);
          msg.textContent = `✅ 連線成功：「${j.form || 'Google 表單'}」目前有 ${(j.rows || []).length} 筆回覆`;
        } catch (e) { msg.textContent = '❌ ' + e.message; }
        return false;
      } },
      { label: '儲存', cls: 'primary', onClick: async (close, dlg) => {
        const url = dlg.querySelector('#sUrl').value.trim();
        const key = dlg.querySelector('#sKey').value.trim();
        if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('網址看起來不是 Apps Script 網頁應用程式網址', { type: 'warn' }); return false; }
        S.sync = Object.assign({}, S.sync, { url, key });
        await saveSync();
        toast('同步設定已儲存');
        render(main);
      } },
    ],
  });
}

// ── 手動新增／編輯 ──
export function openRegDialog(reg, after) {
  const isNew = !reg;
  const r = reg ? JSON.parse(JSON.stringify(reg)) : { id: 'm_' + uid(), src: 'manual', ts: new Date().toISOString(), type: 3, teamName: '', capIdx: 0, players: [], contact: '', discord: '', dc: '', friend: '', agree: '', note: '', raw: {} };
  const box = document.createElement('div');
  const draw = () => {
    const n = r.type;
    while (r.players.length < n) r.players.push({ nick: '', gid: '' });
    const pl = r.players.slice(0, n);
    const labels = n === 3 ? ['隊長', '隊員 1', '隊員 2'] : n === 2 ? ['隊員 A', '隊員 B'] : ['選手'];
    box.innerHTML = `
      <div class="form-grid two">
        <label>報名人數<select id="rType">${[3, 2, 1].map((x) => `<option value="${x}" ${x === n ? 'selected' : ''}>${TYPE_TEXT[x]}</option>`).join('')}</select></label>
        ${n !== 1 ? `<label>隊伍名稱${n === 2 ? '（可留白）' : ''}<input id="rTeam" value="${esc(r.teamName)}"></label>` : '<span></span>'}
      </div>
      ${pl.map((p, i) => `<div class="form-grid two"><label>${labels[i]}｜遊戲暱稱<input data-p="${i}" data-k="nick" value="${esc(p.nick)}"></label><label>${labels[i]}｜遊戲 ID<input data-p="${i}" data-k="gid" value="${esc(p.gid)}" inputmode="numeric"></label></div>`).join('')}
      ${n === 2 ? `<label>隊長<select id="rCap"><option value="" ${r.capIdx == null ? 'selected' : ''}>（暫時留白）</option><option value="0" ${r.capIdx === 0 ? 'selected' : ''}>隊員 A</option><option value="1" ${r.capIdx === 1 ? 'selected' : ''}>隊員 B</option></select></label>` : ''}
      <div class="form-grid two">
        <label>聯絡方式<select id="rContact">${['', 'Discord', '遊戲內好友（沒有 Discord）'].map((x) => `<option ${x === r.contact ? 'selected' : ''} value="${esc(x)}">${x || '（未填）'}</option>`).join('')}${r.contact && !['', 'Discord', '遊戲內好友（沒有 Discord）'].includes(r.contact) ? `<option selected>${esc(r.contact)}</option>` : ''}</select></label>
        <label>Discord 使用者名稱<input id="rDiscord" value="${esc(r.discord)}"></label>
        <label>Discord 群組<select id="rDc">${['', '已加入', '還沒加入，想加入', '不加入'].map((x) => `<option ${x === r.dc ? 'selected' : ''} value="${esc(x)}">${x || '（未填）'}</option>`).join('')}${r.dc && !['', '已加入', '還沒加入，想加入', '不加入'].includes(r.dc) ? `<option selected>${esc(r.dc)}</option>` : ''}</select></label>
        <label>備註<input id="rNote" value="${esc(r.note)}"></label>
      </div>
      <label class="chk"><input type="checkbox" id="rEx" ${r.excluded ? 'checked' : ''}> 不列入（例如重複報名、資格不符；不會被媒合與抽籤）</label>
      ${r.raw && Object.keys(r.raw).length ? `<details><summary>原始資料（${r.src === 'google' ? 'Google 表單' : '匯入檔案'}）</summary><table class="tbl raw">${Object.entries(r.raw).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table></details>` : ''}`;
    box.querySelector('#rType').onchange = (e) => { collect(); r.type = Number(e.target.value); if (r.type === 3) r.capIdx = 0; draw(); };
  };
  const collect = () => {
    const v = (id) => { const el = box.querySelector('#' + id); return el ? el.value.trim() : ''; };
    r.teamName = v('rTeam');
    box.querySelectorAll('input[data-p]').forEach((inp) => { r.players[Number(inp.dataset.p)][inp.dataset.k] = inp.dataset.k === 'gid' ? I.normGid(inp.value) : inp.value.trim(); });
    r.players = r.players.slice(0, r.type);
    if (r.type === 2) { const c = v('rCap'); r.capIdx = c === '' ? null : Number(c); } else r.capIdx = 0;
    r.contact = v('rContact'); r.discord = v('rDiscord'); r.dc = v('rDc'); r.note = v('rNote');
    r.excluded = box.querySelector('#rEx').checked;
  };
  draw();
  const buttons = [];
  if (!isNew) buttons.push({ label: '刪除', cls: 'danger', onClick: async () => {
    if (!(await confirmDlg('刪除這筆報名？如果他已經被分進隊伍，那個位置會變成空位。', { danger: true, ok: '刪除' }))) return false;
    S.regs = S.regs.filter((x) => x.id !== r.id);
    await saveRegs();
    emit('regs');
    toast('已刪除');
    after && after();
  } });
  buttons.push({ label: '取消', cls: 'ghost' });
  buttons.push({ label: '儲存', cls: 'primary', onClick: async () => {
    collect();
    if (r.players.every((p) => !p.nick && !p.gid)) { toast('至少要填一位選手', { type: 'warn' }); return false; }
    if (!isNew && r.src !== 'manual') r.edited = true;
    if (isNew) S.regs.push(r); else S.regs = S.regs.map((x) => (x.id === r.id ? r : x));
    await saveRegs();
    emit('regs');
    toast(isNew ? '已新增報名' : '已儲存');
    after && after();
  } });
  modal({ title: isNew ? '手動新增報名' : '編輯報名資料', body: box, wide: true, buttons });
}

function exportCsv() {
  const head = ['報名時間', '類型', '隊伍名稱', '隊長', '選手1暱稱', '選手1ID', '選手2暱稱', '選手2ID', '選手3暱稱', '選手3ID', '聯絡方式', 'Discord', 'DC群組', '備註', '來源', '不列入', '需要確認'];
  const lines = [head];
  for (const r of S.regs) {
    const p = r.players;
    const cap = r.type === 1 ? '' : r.capIdx == null ? '未定' : (p[r.capIdx] || {}).nick || '';
    lines.push([r.tsText || fmtDateTime(r.ts), TYPE_TEXT[r.type], r.teamName, cap,
      (p[0] || {}).nick || '', (p[0] || {}).gid || '', (p[1] || {}).nick || '', (p[1] || {}).gid || '', (p[2] || {}).nick || '', (p[2] || {}).gid || '',
      r.contact, r.discord, r.dc, r.note, r.src, r.excluded ? '是' : '', (r.flags || []).map((x) => I.FLAG_TEXT[x]).join('、')]);
  }
  const csv = '﻿' + lines.map((l) => l.map((x) => `"${String(x == null ? '' : x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `狂想之息報名資料_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
