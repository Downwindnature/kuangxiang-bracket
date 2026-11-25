// admin/power.js — 選手列表「⚙ 設定」裡的進階功能：每位選手 0～100 的數值（越高越強）
// 只存在後台的私人資料區（private/power）。預設關閉：關閉時媒合與抽籤完全照原本的隨機方式。
// 開啟後也只有「選手列表 ⚙ 設定」和每位選手資料裡的「⚙ 設定」看得到；其他頁面只會默默套用，不顯示任何數字或字眼。
import { S, savePower } from './state.js?v=cd1fa29e';

export const MAX = 100;
export const BASE_VALUE = 50;              // 沒有設定的選手當作 50
export const GAPS = [5, 10, 15, 20, 30];   // 第一場兩邊的差距上限（分）
export const OPT_DEFAULTS = { gap: 10, match: true };

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const clamp = (x) => Math.max(0, Math.min(MAX, Math.round(x)));
const half = (s) => String(s).replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

// 存進來的資料整理成目前的格式；舊版的 1～6 等級換算成 0～100（0、20、40、60、80、100），舊資料一律先維持關閉
export function normalizePower(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const old = src.scale !== MAX;
  const v = {};
  for (const [k, x] of Object.entries(src.v && typeof src.v === 'object' ? src.v : {})) {
    let n = Number(x);
    if (!Number.isFinite(n)) continue;
    if (old) { if (n < 1 || n > 6) continue; n = (n - 1) * 20; }
    v[k] = clamp(n);
  }
  const o = !old && src.opt && typeof src.opt === 'object' ? src.opt : {};
  return {
    scale: MAX,
    on: !old && src.on === true,
    v,
    opt: { gap: GAPS.includes(Number(o.gap)) ? Number(o.gap) : OPT_DEFAULTS.gap, match: o.match !== false },
    at: Number(src.at) || 0,
  };
}

export function powerData() {
  const d = S.power;
  if (!d || typeof d !== 'object' || d.scale !== MAX || !d.v || typeof d.v !== 'object' || !d.opt || typeof d.opt !== 'object') S.power = normalizePower(d);
  return S.power;
}

export const isOn = () => powerData().on === true;
export const powerOpts = () => Object.assign({}, OPT_DEFAULTS, powerData().opt);

// 以遊戲 ID 記（重新同步表單也不會掉）；沒有 ID 的才用暱稱
export const powerKey = (p) => (p && p.gid ? String(p.gid) : p && p.nick ? `n:${String(p.nick).trim()}` : '');

export function playerPower(p) {
  const k = powerKey(p);
  const x = k ? powerData().v[k] : undefined;
  return isNum(x) ? clamp(x) : null;
}

const touch = async (d) => { d.at = Date.now(); await savePower(); };

export async function setPlayerPower(p, x) {
  const k = powerKey(p);
  if (!k) return false;
  const d = powerData();
  if (isNum(x)) d.v[k] = clamp(x); else delete d.v[k];
  await touch(d);
  return true;
}

export async function setOn(on) {
  const d = powerData();
  d.on = !!on;
  await touch(d);
}

export async function setPowerOpts(patch) {
  const d = powerData();
  d.opt = Object.assign(powerOpts(), patch);
  await touch(d);
}

export async function clearAllPower() {
  const d = powerData();
  d.v = {};
  await touch(d);
}

export const hasAnyPower = () => Object.values(powerData().v).some(isNum);
export const countSet = (players) => players.filter((p) => playerPower(p) != null).length;

// 「0」～「100」（可以有「分」、全形數字）；「-」「清除」= 清除；其他 = 看不懂（undefined）
export function parseValue(s) {
  const t = half(String(s == null ? '' : s).trim()).replace(/分$/, '');
  if (!t) return undefined;
  if (/^(-|—|清除|無|未設定)$/.test(t)) return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  return n >= 0 && n <= MAX ? clamp(n) : undefined;
}

// 一次貼上：每行「遊戲 ID（或暱稱） 數字」
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
    const x = parseValue(parts[parts.length - 1]);
    if (x === undefined) { bad.push(l); continue; }
    const who = parts.slice(0, -1).join(' ');
    const p = byGid.get(half(who).replace(/\s+/g, '')) || byNick.get(who.toLowerCase());
    if (!p) { miss.push(who); continue; }
    const k = powerKey(p);
    if (x == null) delete d.v[k]; else d.v[k] = x;
    ok++;
  }
  if (ok) await touch(d);
  return { ok, miss, bad };
}

const valueOf = (p) => { const x = p ? playerPower(p) : null; return x == null ? BASE_VALUE : x; };

// 一隊 = 隊員的平均（沒設定的隊員當作 50）；只在內部計算用，畫面上不顯示
export function teamValue(t, regMapObj) {
  if (!t || !t.members || !t.members.length) return null;
  let sum = 0;
  for (const ref of t.members) { const r = regMapObj[ref.r]; sum += valueOf(r && r.players[ref.i]); }
  return sum / t.members.length;
}

// 給選手抽籤頁：有開啟、而且至少設定了一位才回傳（關閉 = 空物件 = 原本的隨機）
export function matchOptions() {
  if (!isOn() || !powerOpts().match || !hasAnyPower()) return {};
  return { strength: (reg, i) => valueOf(reg.players[i]) };
}

export function drawOptions(regMapObj) {
  if (!isOn() || !hasAnyPower()) return {};
  const byId = new Map(S.teams.map((t) => [t.id, t]));
  return { strength: (id) => teamValue(byId.get(id), regMapObj), maxGap: Number(powerOpts().gap) || OPT_DEFAULTS.gap };
}
