// admin/state.js — 後台的資料狀態、存檔、發布到前台、還原紀錄
import { PATHS } from '../store.js?v=f641a603';
import { parseJSON } from '../util.js?v=f641a603';
import { publicView, teamCount, clone } from '../bracket.js?v=f641a603';
import { regMap, teamLabel, memberInfo } from '../matcher.js?v=f641a603';
import { checkRegs } from '../importer.js?v=f641a603';
import { withDefaults } from '../banner.js?v=f641a603';

export const SETTINGS_DEFAULTS = {
  title: '',          // 賽事標題：預設留空（前台看板待機時就是空白）
  subtitle: '',
  stage: 'auto',        // auto 自動 / blank 空白 / teams 參賽名單 / bracket 賽程表
  nameMode: 'team',     // team 隊伍名稱 / captain 隊長暱稱 / both 隊名（隊長）
  showTimes: true,
  showScores: true,
  showZero: true,
  showChampion: true,
  showAdminBtn: true,
  gridMotion: true,
  listMembers: true,
};

export const S = {
  store: null,
  user: null,
  regs: [],
  teams: [],
  bracket: null,
  settings: Object.assign({}, SETTINGS_DEFAULTS),
  banner: withDefaults(null),
  sync: {},
  roster: null,
  power: null,   // 選手列表的進階設定（只存在後台的私人資料區）
  ui: {},
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit(why) { for (const f of listeners) { try { f(why); } catch (e) { console.error(e); } } }

const cache = {}; // path → 最後一次寫入／讀到的字串，用來分辨是不是別人改的

function str(v) { return v == null ? null : typeof v === 'string' ? v : JSON.stringify(v); }

async function put(path, value) {
  const v = str(value);
  cache[path] = v;
  await S.store.set(path, v);
}

function applyPrivate(p) {
  p = p || {};
  S.regs = checkRegs((parseJSON(p.regs, {}) || {}).list || []);
  S.teams = (parseJSON(p.teams, {}) || {}).list || [];
  S.bracket = parseJSON(p.bracket, null);
  S.sync = p.sync || {};
  S.roster = parseJSON(p.roster, null);
  S.power = parseJSON(p.power, null);
}

function applyPublic(p) {
  p = p || {};
  S.settings = Object.assign({}, SETTINGS_DEFAULTS, parseJSON(p.settings, {}) || {});
  S.banner = withDefaults(parseJSON(p.banner, null));
}

export async function loadAll() {
  const [priv, pub] = await Promise.all([S.store.get('private'), S.store.get('public')]);
  applyPrivate(priv);
  applyPublic(pub);
  for (const k of ['regs', 'teams', 'bracket', 'roster', 'power']) cache[`private/${k}`] = str((priv || {})[k]);
  for (const k of ['settings', 'banner', 'bracket', 'teams']) cache[`public/${k}`] = str((pub || {})[k]);
}

// 其他管理員（或另一個分頁）改了資料時，同步到這裡
export function watchRemote() {
  let first = { private: true, public: true };
  const handle = (root, keys, apply) => (val) => {
    if (first[root]) { first[root] = false; return; }
    val = val || {};
    let changed = false;
    for (const k of keys) {
      const s = str(val[k]);
      if (s !== cache[`${root}/${k}`]) { cache[`${root}/${k}`] = s; changed = true; }
    }
    if (changed) { apply(val); emit('remote'); }
  };
  S.store.watch('private', handle('private', ['regs', 'teams', 'bracket', 'roster', 'power'], applyPrivate));
  S.store.watch('public', handle('public', ['settings', 'banner'], applyPublic));
}

export const rm = () => regMap(S.regs);

export function teamNames() {
  const m = rm();
  const out = {};
  for (const t of S.teams) out[t.id] = teamLabel(t, m, S.settings.nameMode);
  return out;
}

export function teamById(id) { return S.teams.find((t) => t.id === id) || null; }

export async function saveRegs() {
  checkRegs(S.regs);
  await put(PATHS.regs, { list: S.regs, at: Date.now() });
  await publishTeamsIfShown();
  if (S.bracket && S.bracket.published) await publishBracket(); // 改了暱稱：前台賽程上的名字跟著更新
}

export async function saveTeams() {
  await put(PATHS.teams, { list: S.teams, at: Date.now() });
  await publishTeamsIfShown();
  if (S.bracket && S.bracket.published) await publishBracket();
}

export async function saveBracket() {
  await put(PATHS.bracket, S.bracket);
  await publishBracket();
}

export async function saveSettings() {
  await put(PATHS.pubSettings, S.settings);
  await publishBracket();
  await publishTeamsIfShown();
}

export async function saveBanner() {
  await put(PATHS.pubBanner, S.banner);
}

// 直播抽籤：前台的看板與賽程一次寫入，前台不會先看到賽程上的名字、才看到抽籤動畫
export async function saveDraw() {
  await put(PATHS.bracket, S.bracket);
  const pub = S.bracket && S.bracket.published ? str(publicView(S.bracket, teamNames(), S.bracket.reveal)) : null;
  const banner = str(S.banner);
  cache[PATHS.pubBracket] = pub;
  cache[PATHS.pubBanner] = banner;
  await S.store.update(PATHS.pub, { bracket: pub, banner });
}

export async function saveSync() {
  await S.store.set(PATHS.sync, S.sync);
}

export async function saveRoster() {
  await put(PATHS.roster, S.roster);
}

export async function savePower() {
  await put(PATHS.power, S.power);
}

export async function publishBracket() {
  if (!S.bracket || !S.bracket.published) {
    if (cache[PATHS.pubBracket] != null) await put(PATHS.pubBracket, null);
    return;
  }
  await put(PATHS.pubBracket, publicView(S.bracket, teamNames(), S.bracket.reveal));
}

export function publicTeamsPayload() {
  const m = rm();
  const nick = (ref) => (memberInfo(m, ref) || {}).nick || '';
  if (S.teams.length) {
    const inc = S.teams.filter((t) => t.include);
    const waiting = S.teams.filter((t) => !t.include).flatMap((t) => t.members.map(nick)).filter(Boolean);
    return { title: '參賽隊伍', teams: inc.map((t) => ({ n: teamLabel(t, m, S.settings.nameMode), m: t.members.map(nick), c: t.cap })), waiting };
  }
  const regs = S.regs.filter((r) => !r.excluded);
  return {
    title: '報名隊伍',
    teams: regs.filter((r) => r.type === 3).map((r) => ({ n: r.teamName || (r.players[0] && r.players[0].nick) || '未命名', m: r.players.map((p) => p.nick), c: 0 })),
    waiting: regs.filter((r) => r.type !== 3).flatMap((r) => r.players.map((p) => p.nick)).filter(Boolean),
  };
}

// 參賽名單只有在「顯示內容」選了參賽名單時才放到公開區，平常不公開
export async function publishTeamsIfShown() {
  if (S.settings.stage === 'teams') await put(PATHS.pubTeams, publicTeamsPayload());
  else if (cache[PATHS.pubTeams] != null) await put(PATHS.pubTeams, null);
}

// ── 還原紀錄（清單只存摘要，完整資料另外存，打開「重置」頁時不用下載全部備份）──
export async function snapshot(reason) {
  const data = JSON.stringify({ regs: S.regs, teams: S.teams, bracket: S.bracket, settings: S.settings, banner: S.banner });
  const key = await S.store.push(PATHS.history, {
    at: S.store.now(),
    reason,
    regs: S.regs.length,
    teams: S.teams.filter((t) => t.include).length,
    bracket: S.bracket ? teamCount(S.bracket) : 0,
    published: !!(S.bracket && S.bracket.published),
  });
  await S.store.set(`${PATHS.historyData}/${key}`, data);
  const keys = await S.store.keys(PATHS.history);
  const max = S.store.mode === 'local' ? 12 : 30;
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await deleteHistory(k);
  return key;
}

export async function listHistory() {
  const list = await S.store.lastN(PATHS.history, 40);
  return list.reverse();
}

export async function deleteHistory(key) {
  await S.store.remove(`${PATHS.history}/${key}`);
  await S.store.remove(`${PATHS.historyData}/${key}`);
}

export async function restoreHistory(key) {
  const [h, raw] = await Promise.all([S.store.get(`${PATHS.history}/${key}`), S.store.get(`${PATHS.historyData}/${key}`)]);
  if (!h || !raw) throw new Error('找不到這筆紀錄的備份資料');
  const d = JSON.parse(raw);
  await snapshot('還原前自動備份');
  S.regs = checkRegs(d.regs || []);
  S.teams = d.teams || [];
  S.bracket = d.bracket || null;
  if (d.settings) S.settings = Object.assign({}, SETTINGS_DEFAULTS, d.settings);
  S.banner = withDefaults(d.banner);
  await put(PATHS.regs, { list: S.regs, at: Date.now() });
  await put(PATHS.teams, { list: S.teams, at: Date.now() });
  await put(PATHS.bracket, S.bracket);
  await put(PATHS.pubSettings, S.settings);
  await saveBanner();
  await publishBracket();
  await publishTeamsIfShown();
  emit('restore');
  return h;
}

export async function resetAll() {
  await snapshot('重置前');
  S.regs = [];
  S.teams = [];
  S.bracket = null;
  S.banner = Object.assign(withDefaults(S.banner), { mode: 'idle', cur: null, next: 'auto', at: S.store.now(), draw: null, custom: '' });
  await put(PATHS.regs, { list: [], at: Date.now() });
  await put(PATHS.teams, { list: [], at: Date.now() });
  await put(PATHS.bracket, null);
  await put(PATHS.pubBracket, null);
  await put(PATHS.pubTeams, null);
  await saveBanner();
  emit('reset');
}

export async function latestResetSnapshot() {
  const list = await listHistory();
  return list.find((h) => h.reason === '重置前') || null;
}

export { clone };
