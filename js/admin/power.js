// admin/power.js — 選手列表「設定」裡的進階功能：每位選手的戰力等級
// 只存在後台的私人資料區（private/power），只有選手列表的設定裡看得到；
// 選手抽籤頁只會默默套用（媒合、抽籤），畫面上不會出現任何相關字眼。
import { S, savePower } from './state.js?v=2628f905';

export const TIERS = [
  { v: 1, name: '基本' },
  { v: 2, name: '初階' },
  { v: 3, name: '中階' },
  { v: 4, name: '中高階' },
  { v: 5, name: '高階' },
  { v: 6, name: '巔峰' },
];
export const GAPS = [0.5, 1, 1.5, 2];
export const POWER_DEFAULTS = { draw: true, gap: 1, match: false };

export const tierName = (v) => (TIERS.find((t) => t.v === v) || {}).name || '';
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

export function powerData() {
  if (!S.power || typeof S.power !== 'object') S.power = { v: {}, opt: {} };
  if (!S.power.v || typeof S.power.v !== 'object') S.power.v = {};
  if (!S.power.opt || typeof S.power.opt !== 'object') S.power.opt = {};
  return S.power;
}

export const powerOpts = () => Object.assign({}, POWER_DEFAULTS, (S.power && S.power.opt) || {});

// 以遊戲 ID 記（重新同步表單也不會掉）；沒有 ID 的才用暱稱
export const powerKey = (p) => (p && p.gid ? String(p.gid) : p && p.nick ? `n:${String(p.nick).trim()}` : '');

export function playerPower(p) {
  const k = powerKey(p);
  const v = k && S.power && S.power.v ? S.power.v[k] : null;
  return isNum(v) ? v : null;
}

export async function setPlayerPower(p, v) {
  const k = powerKey(p);
  if (!k) return false;
  const d = powerData();
  if (isNum(v) && v >= 1 && v <= 6) d.v[k] = v;
  else delete d.v[k];
  d.at = Date.now();
  await savePower();
  return true;
}

export async function setPowerOpts(patch) {
  const d = powerData();
  d.opt = Object.assign({}, powerOpts(), patch);
  d.at = Date.now();
  await savePower();
}

export async function clearAllPower() {
  const d = powerData();
  d.v = {};
  d.at = Date.now();
  await savePower();
}

export const hasAnyPower = () => !!(S.power && S.power.v && Object.values(S.power.v).some(isNum));

// 隊伍：隊員平均（沒設定的隊員不算；整隊都沒設定 = null）
export function teamPower(t, regMapObj) {
  if (!t) return null;
  const vals = [];
  for (const ref of t.members) {
    const r = regMapObj[ref.r];
    const p = r && r.players[ref.i];
    const v = p ? playerPower(p) : null;
    if (isNum(v)) vals.push(v);
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export const fmtPower = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toFixed(v % 1 ? 1 : 0) : '—');

// 「1」～「6」或等級名稱；0、-、清除 = 清除
export function parseTier(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return undefined;
  if (/^(0|-|—|清除|無|未設定)$/.test(t)) return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
  const hit = TIERS.find((x) => x.name === t || x.name === `${t}階` || x.name.replace('階', '') === t);
  return hit ? hit.v : undefined;
}

// 一次貼上：每行「遊戲 ID（或暱稱） 等級」
export async function bulkApply(text, players) {
  const byGid = new Map();
  const byNick = new Map();
  for (const p of players) {
    if (p.gid) byGid.set(String(p.gid), p);
    if (p.nick) byNick.set(String(p.nick).trim().toLowerCase(), p);
  }
  const d = powerData();
  let ok = 0;
  const miss = [];
  const bad = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const parts = l.split(/[\t,，:：]+|\s+/).filter(Boolean);
    if (parts.length < 2) { bad.push(l); continue; }
    const v = parseTier(parts[parts.length - 1]);
    if (v === undefined) { bad.push(l); continue; }
    const who = parts.slice(0, -1).join(' ');
    const digits = who.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, '');
    const p = byGid.get(digits) || byNick.get(who.toLowerCase());
    if (!p) { miss.push(who); continue; }
    const k = powerKey(p);
    if (v == null) delete d.v[k]; else d.v[k] = v;
    ok++;
  }
  if (ok) { d.at = Date.now(); await savePower(); }
  return { ok, miss, bad };
}

// 給選手抽籤頁：有開啟才回傳（沒有任何文字）
export function matchOptions() {
  const o = powerOpts();
  if (!o.match || !hasAnyPower()) return {};
  return { strength: (reg, i) => playerPower(reg.players[i]) };
}

export function drawOptions(regMapObj) {
  const o = powerOpts();
  if (!o.draw || !hasAnyPower()) return {};
  return { strength: (id) => teamPower(S.teams.find((t) => t.id === id), regMapObj), maxGap: Number(o.gap) || 1 };
}
