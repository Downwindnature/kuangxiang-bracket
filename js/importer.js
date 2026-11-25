// importer.js — 表單匯入：讀 Excel / CSV / Google 表單同步資料，整理成報名資料並統計
import { nfkc } from './util.js?v=f641a603';

export const FIELDS = [
  ['ts', '時間戳記'],
  ['size', '報名人數'],
  ['t3_name', '隊伍名稱（3 人）'],
  ['t3_cap_nick', '隊長｜遊戲暱稱'],
  ['t3_cap_gid', '隊長｜遊戲 ID'],
  ['t3_m1_nick', '隊員 1｜遊戲暱稱'],
  ['t3_m1_gid', '隊員 1｜遊戲 ID'],
  ['t3_m2_nick', '隊員 2｜遊戲暱稱'],
  ['t3_m2_gid', '隊員 2｜遊戲 ID'],
  ['t2_name', '隊伍名稱（2 人，可留白）'],
  ['t2_a_nick', '隊員 A｜遊戲暱稱'],
  ['t2_a_gid', '隊員 A｜遊戲 ID'],
  ['t2_b_nick', '隊員 B｜遊戲暱稱'],
  ['t2_b_gid', '隊員 B｜遊戲 ID'],
  ['t2_cap', '隊長（2 人，可留白）'],
  ['s_nick', '1 人｜遊戲暱稱'],
  ['s_gid', '1 人｜遊戲 ID'],
  ['contact', '聯絡方式'],
  ['discord', 'Discord 使用者名稱'],
  ['dc', '是否已加入 Discord 群組'],
  ['friend', '加好友確認'],
  ['agree', '報名確認'],
  ['note', '備註'],
];
export const FIELD_LABEL = Object.fromEntries(FIELDS);

export function normHeader(h) {
  return nfkc(h).toLowerCase().replace(/\s+/g, '').replace(/｜/g, '|');
}

const NICK = /暱稱|名稱|名字|nickname|name/;
const GID = /id|編號|uid/;
const RULES = [
  ['ts', (h) => /時間戳記|timestamp|提交時間|填答時間|送出時間|填寫時間|作答時間/.test(h)],
  ['size', (h) => /報名人數|報名類型|報名方式|參加人數/.test(h)],
  ['t2_name', (h) => /隊伍名稱|隊名/.test(h) && /留白|2人|兩人/.test(h)],
  ['t2_cap', (h) => /^隊長/.test(h) && (/留白|2人|兩人/.test(h)) && !NICK.test(h.replace(/隊長/, '')) && !GID.test(h.replace(/隊長/, ''))],
  ['t3_name', (h) => /隊伍名稱|隊名/.test(h)],
  ['t3_cap_gid', (h) => /隊長/.test(h) && GID.test(h)],
  ['t3_cap_nick', (h) => /隊長/.test(h) && (NICK.test(h) || h === '隊長')],
  ['t3_m1_gid', (h) => /隊員1/.test(h) && GID.test(h)],
  ['t3_m1_nick', (h) => /隊員1/.test(h)],
  ['t3_m2_gid', (h) => /隊員2/.test(h) && GID.test(h)],
  ['t3_m2_nick', (h) => /隊員2/.test(h)],
  ['t2_a_gid', (h) => /隊員a/.test(h) && GID.test(h)],
  ['t2_a_nick', (h) => /隊員a/.test(h)],
  ['t2_b_gid', (h) => /隊員b/.test(h) && GID.test(h)],
  ['t2_b_nick', (h) => /隊員b/.test(h)],
  ['dc', (h) => /discord|dc/.test(h) && /群組|加入|伺服器|server/.test(h)],
  ['discord', (h) => /discord/.test(h)],
  ['contact', (h) => /聯絡方式|聯繫方式/.test(h)],
  ['friend', (h) => /好友/.test(h)],
  ['agree', (h) => /報名確認|同意|詳閱|規則確認/.test(h)],
  ['note', (h) => /備註|其他|留言|想說/.test(h)],
  ['s_gid', (h) => /^(遊戲)?id$|^遊戲編號$/.test(h)],
  ['s_nick', (h) => /^(遊戲)?暱稱$|^遊戲名稱$/.test(h)],
];

// 依標題自動對應欄位；回傳 { 欄位: 第幾欄 }
export function detectMapping(headers) {
  const map = {};
  const used = new Set();
  const hs = headers.map(normHeader);
  for (const [field, test] of RULES) {
    if (map[field] != null) continue;
    for (let i = 0; i < hs.length; i++) {
      if (used.has(i) || !hs[i]) continue;
      if (test(hs[i])) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

export function looksLikeGoogleForm(map) {
  return ['size', 't3_cap_nick', 't2_a_nick', 's_nick'].every((f) => map[f] != null);
}

// ── CSV ──
export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const delim = guessDelim(text);
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

function guessDelim(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, '\t': 0, ';': 0 };
  let q = false;
  for (const c of first) { if (c === '"') q = !q; else if (!q && c in counts) counts[c]++; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

// ── Excel（需要 SheetJS）──
export function sheetsFromWorkbook(XLSX, data) {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    return { name, rows: rows.filter((r) => r.some((x) => String(x == null ? '' : x).trim() !== '')) };
  }).filter((s) => s.rows.length);
}

// 找出標題列（前 10 列裡面對到最多欄位的那一列）
export function findHeaderRow(rows) {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const score = Object.keys(detectMapping(rows[i].map((x) => String(x == null ? '' : x)))).length;
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}

// ── 整理成報名資料 ──
export function str(v) {
  if (v == null) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
  return nfkc(v).trim();
}

export function normGid(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v)) : '';
  return nfkc(v).replace(/[\s,]/g, '').replace(/^'+/, '');
}

export function parseTs(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString();
  if (typeof v === 'number' && v > 20000 && v < 80000) { // Excel 日期序號
    const ms = Math.round((v - 25569) * 86400000);
    const d = new Date(ms);
    return new Date(d.getTime() + d.getTimezoneOffset() * 60000).toISOString();
  }
  const s = nfkc(v).trim();
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T]+(上午|下午|AM|PM|am|pm)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(上午|下午|AM|PM|am|pm)?)?/.exec(s);
  if (m) {
    let hh = Number(m[5] || 0);
    const ap = m[4] || m[8];
    if (ap) {
      const pm = /下午|pm/i.test(ap);
      if (pm && hh < 12) hh += 12;
      if (!pm && hh === 12) hh = 0;
    }
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, Number(m[6] || 0), Number(m[7] || 0));
    return isNaN(d) ? '' : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString();
}

// 取第一個出現的人數（「2 人（主辦方協助媒合第 3 位隊員）」要判成 2）
export function parseSize(v) {
  const s = nfkc(v);
  const m = /[123一二兩三單]/.exec(s);
  if (!m) return 0;
  return { '1': 1, '一': 1, '單': 1, '2': 2, '二': 2, '兩': 2, '3': 3, '三': 3 }[m[0]];
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// rows：第 0 列是標題；map：detectMapping 的結果
export function normalizeRows(rows, map, { src = 'excel', header = 0, ids = null } = {}) {
  const headers = (rows[header] || []).map((x) => String(x == null ? '' : x));
  const out = [];
  let skipped = 0;
  for (let ri = header + 1; ri < rows.length; ri++) {
    const row = rows[ri] || [];
    const get = (f) => (map[f] == null ? '' : row[map[f]]);
    const s = (f) => str(get(f));
    const g = (f) => normGid(get(f));
    let size = parseSize(s('size'));
    if (!size) {
      if (s('t3_cap_nick') || s('t3_m1_nick') || s('t3_m2_nick')) size = 3;
      else if (s('t2_a_nick') || s('t2_b_nick')) size = 2;
      else if (s('s_nick') || g('s_gid')) size = 1;
    }
    if (!size) { skipped++; continue; }
    let players, teamName = '', capIdx = 0;
    if (size === 3) {
      players = [[s('t3_cap_nick'), g('t3_cap_gid')], [s('t3_m1_nick'), g('t3_m1_gid')], [s('t3_m2_nick'), g('t3_m2_gid')]];
      teamName = s('t3_name');
    } else if (size === 2) {
      players = [[s('t2_a_nick'), g('t2_a_gid')], [s('t2_b_nick'), g('t2_b_gid')]];
      teamName = s('t2_name');
      const c = normHeader(s('t2_cap'));
      capIdx = /a$|^a|隊員a|甲/.test(c) ? 0 : /b$|^b|隊員b|乙/.test(c) ? 1 : null;
    } else {
      players = [[s('s_nick'), g('s_gid')]];
    }
    players = players.map(([nick, gid]) => ({ nick, gid }));
    const ts = parseTs(get('ts'));
    const raw = {};
    headers.forEach((h, i) => {
      const v = row[i];
      if (h && v !== '' && v != null) raw[h] = v instanceof Date ? v.toISOString() : String(v);
    });
    const key = `${ts}|${players.map((p) => p.gid || p.nick).join(',')}`;
    const id = ids && ids[ri] ? `g_${ids[ri]}` : `r_${hash(src + '|' + key)}`;
    out.push({
      id,
      src,
      ts,
      tsText: str(get('ts')) && !(get('ts') instanceof Date) ? str(get('ts')) : '',
      type: size,
      teamName,
      capIdx,
      players,
      contact: s('contact'),
      discord: s('discord'),
      dc: s('dc'),
      friend: s('friend'),
      agree: s('agree'),
      note: s('note'),
      raw,
    });
  }
  return { regs: out, skipped, headers };
}

// Google 表單同步（Apps Script 回傳的 JSON）→ rows
export function rowsFromSync(json) {
  const cols = (json && json.columns) || [];
  const header = ['時間戳記', ...cols];
  const rows = [header];
  const ids = [null];
  for (const r of (json && json.rows) || []) {
    rows.push([r.ts ? new Date(r.ts) : '', ...cols.map((c) => (r.values && r.values[c] != null ? r.values[c] : ''))]);
    ids.push(r.id || null);
  }
  return { rows, ids };
}

export function dedupeKey(r) {
  return `${r.type}|${r.players.map((p) => p.gid || p.nick).join(',')}`;
}

// 合併：已存在（同一 id，或同類型且同一組 ID）的略過
export function mergeRegs(existing, incoming) {
  const ids = new Set(existing.map((r) => r.id));
  const keys = new Set(existing.map(dedupeKey));
  const added = [];
  let dup = 0;
  for (const r of incoming) {
    if (ids.has(r.id) || keys.has(dedupeKey(r))) { dup++; continue; }
    added.push(r);
    ids.add(r.id); keys.add(dedupeKey(r));
  }
  return { list: existing.concat(added), added: added.length, dup };
}

// Google 同步：用最新回覆取代所有 google 來源的資料，但保留後台手動改過的那幾筆
export function applySync(existing, incoming) {
  const keep = existing.filter((r) => r.src !== 'google' || r.edited);
  const keepIds = new Set(keep.map((r) => r.id));
  const fresh = incoming.filter((r) => !keepIds.has(r.id));
  const before = new Set(existing.filter((r) => r.src === 'google').map((r) => r.id));
  const added = fresh.filter((r) => !before.has(r.id)).length;
  return { list: keep.concat(fresh).sort((a, b) => String(a.ts).localeCompare(String(b.ts))), added, total: fresh.length };
}

// ── 檢查與統計 ──
// 「遊戲內好友（沒有 Discord）」不能算成 Discord
export const isDiscordContact = (c) => /discord/i.test(c || '') && !/沒有|没有|無|不用/.test(c || '');

export const FLAG_TEXT = {
  noNick: '缺遊戲暱稱',
  noGid: '缺遊戲 ID',
  badGid: 'ID 不是數字',
  dupGid: 'ID 重複報名',
  noTeam: '缺隊伍名稱',
  noAgree: '未勾選報名確認',
  noDiscord: '選 Discord 但沒填名稱',
  noContact: '沒選聯絡方式',
};

export function checkRegs(regs) {
  const count = {};
  for (const r of regs) {
    if (r.excluded) continue;
    for (const p of r.players) if (p.gid) count[p.gid] = (count[p.gid] || 0) + 1;
  }
  for (const r of regs) {
    const f = [];
    if (r.players.some((p) => !p.nick)) f.push('noNick');
    if (r.players.some((p) => !p.gid)) f.push('noGid');
    if (r.players.some((p) => p.gid && !/^\d+$/.test(p.gid))) f.push('badGid');
    if (!r.excluded && r.players.some((p) => p.gid && count[p.gid] > 1)) f.push('dupGid');
    if (r.type === 3 && !r.teamName) f.push('noTeam');
    if (r.src !== 'manual' && !r.agree) f.push('noAgree');
    if (isDiscordContact(r.contact) && !r.discord) f.push('noDiscord');
    if (r.src !== 'manual' && !r.contact) f.push('noContact');
    r.flags = f;
  }
  return regs;
}

export function regStats(regs) {
  const s = { total: 0, t3: 0, t2: 0, t1: 0, players: 0, discord: 0, friendOnly: 0, dcJoined: 0, dcWant: 0, dcNo: 0, flagged: 0, excluded: 0 };
  for (const r of regs) {
    if (r.excluded) { s.excluded++; continue; }
    s.total++;
    s['t' + r.type]++;
    s.players += r.players.length;
    if (isDiscordContact(r.contact)) s.discord++;
    else if (r.contact) s.friendOnly++;
    if (/已加入/.test(r.dc)) s.dcJoined++;
    else if (/想加入|還沒/.test(r.dc)) s.dcWant++;
    else if (/不加入/.test(r.dc)) s.dcNo++;
    if (r.flags && r.flags.length) s.flagged++;
  }
  const m = Math.min(s.t2, s.t1);
  s.canTeams = s.t3 + m + Math.floor((s.t1 - m) / 3);
  s.leftPairs = s.t2 - m;
  s.leftSingles = (s.t1 - m) % 3;
  return s;
}

// ── 玩家名冊（例如「狂想之息玩家名字紀錄表」）──
export function parseRoster(rows) {
  let hi = -1, map = {};
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hs = rows[i].map(normHeader);
    const idx = (re) => hs.findIndex((h) => re.test(h));
    const gid = hs.findIndex((h) => /^遊戲id$|^id$|遊戲id/.test(h) && !/小號/.test(h));
    if (gid >= 0) {
      hi = i;
      map = { gid, name: idx(/目前名字|遊戲名字|名字|暱稱/), common: idx(/經常稱呼|稱呼|綽號/), altName: idx(/小號名字|小號暱稱/), altGid: idx(/小號id/), region: idx(/現居|地區|居住/), note: idx(/備註/) };
      break;
    }
  }
  if (hi < 0) return null;
  const byGid = {};
  let count = 0;
  const at = (row, k) => (map[k] >= 0 ? str(row[map[k]]) : '');
  for (let i = hi + 1; i < rows.length; i++) {
    const row = rows[i];
    const gid = normGid(row[map.gid]);
    const base = { name: at(row, 'name'), common: at(row, 'common'), region: at(row, 'region'), note: at(row, 'note') };
    if (gid) { byGid[gid] = Object.assign({}, base); count++; }
    const alt = map.altGid >= 0 ? normGid(row[map.altGid]) : '';
    if (alt && !byGid[alt]) byGid[alt] = Object.assign({}, base, { name: at(row, 'altName') || base.name, alt: true });
  }
  return { byGid, count };
}
