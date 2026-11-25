// matcher.js — 選手抽籤：3 人隊直接成隊，2 人組與 1 人報名隨機媒合成 3 人一隊
import { shuffle, cryptoRandom } from './bracket.js?v=2628f905';
import { uid } from './util.js?v=2628f905';

export function regMap(regs) {
  const m = {};
  for (const r of regs) m[r.id] = r;
  return m;
}

export function memberInfo(rm, ref) {
  const r = rm[ref.r];
  if (!r) return null;
  const p = r.players[ref.i];
  return p ? { nick: p.nick, gid: p.gid, reg: r } : null;
}

export function teamComplete(t, rm) {
  return t.members.length === 3 && t.members.every((m) => memberInfo(rm, m));
}

// strength(reg, i) 有給的話（後台的平衡設定）：先照原本的方式隨機媒合，再調整成各隊強度比較平均
export function buildTeams(regs, { rng = cryptoRandom, strength = null } = {}) {
  const active = regs.filter((r) => !r.excluded);
  const teams = [];
  for (const r of active.filter((x) => x.type === 3)) {
    teams.push({ id: uid('t_'), name: r.teamName || '', origin: 'self', members: r.players.map((_, i) => ({ r: r.id, i })), cap: 0, include: r.players.length === 3 });
  }
  const pairs = shuffle(active.filter((x) => x.type === 2), rng);
  const singles = shuffle(active.filter((x) => x.type === 1), rng);
  for (const p of pairs) {
    const members = p.players.map((_, i) => ({ r: p.id, i }));
    if (singles.length) { const s = singles.pop(); members.push({ r: s.id, i: 0 }); }
    teams.push({ id: uid('t_'), name: p.teamName || '', origin: 'matched', members, cap: p.capIdx == null ? 0 : p.capIdx, capPending: p.capIdx == null, include: members.length === 3 });
  }
  while (singles.length >= 3) {
    const g = singles.splice(0, 3);
    teams.push({ id: uid('t_'), name: '', origin: 'matched', members: g.map((s) => ({ r: s.id, i: 0 })), cap: 0, capPending: true, include: true });
  }
  if (singles.length) {
    teams.push({ id: uid('t_'), name: '', origin: 'matched', members: singles.map((s) => ({ r: s.id, i: 0 })), cap: 0, capPending: true, include: false });
  }
  let n = 1;
  for (const t of teams) {
    if (!t.name) { t.name = `媒合隊伍 ${String(n++).padStart(2, '0')}`; t.autoName = true; }
  }
  if (strength) balanceTeams(teams, regMap(active), strength);
  return teams;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// 在媒合出來的完整隊伍之間交換「1 人報名」的選手，每次交換都要讓各隊平均更接近整體平均才換。
// 2 人報名的兩位一定在同一隊；沒湊滿 3 人、不列入抽籤的那一隊不動（誰沒湊滿仍然是隨機的）。
export function balanceTeams(teams, rm, strength) {
  const val = (ref) => { const r = rm[ref.r]; const x = r ? strength(r, ref.i) : null; return isNum(x) ? x : null; };
  const known = [];
  for (const t of teams) for (const m of t.members) { const x = val(m); if (x != null) known.push(x); }
  if (known.length < 2) return teams;
  const mean = known.reduce((a, b) => a + b, 0) / known.length;
  const v = (ref) => { const x = val(ref); return x == null ? mean : x; };
  const pool = teams.filter((t) => t.origin === 'matched' && t.include && t.members.length === 3);
  const slots = [];
  pool.forEach((t, ti) => t.members.forEach((m, mi) => { const r = rm[m.r]; if (r && r.type === 1) slots.push({ ti, mi }); }));
  const sum = pool.map((t) => t.members.reduce((a, m) => a + v(m), 0));
  const cost = (x) => (x / 3 - mean) ** 2;
  let again = true, guard = 0;
  while (again && guard++ < 60) {
    again = false;
    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const A = slots[a], B = slots[b];
        if (A.ti === B.ti) continue;
        const ma = pool[A.ti].members[A.mi], mb = pool[B.ti].members[B.mi];
        const d = v(mb) - v(ma);
        if (cost(sum[A.ti] + d) + cost(sum[B.ti] - d) < cost(sum[A.ti]) + cost(sum[B.ti]) - 1e-9) {
          pool[A.ti].members[A.mi] = mb;
          pool[B.ti].members[B.mi] = ma;
          sum[A.ti] += d;
          sum[B.ti] -= d;
          again = true;
        }
      }
    }
  }
  return teams;
}

// 報名資料有新增／刪除時：保留現有隊伍，只把還沒進隊伍的人補進來（不打亂已經組好的隊）
export function refreshTeams(teams, regs, { rng = cryptoRandom, strength = null } = {}) {
  const rm = regMap(regs.filter((r) => !r.excluded));
  let list = teams.map((t) => Object.assign({}, t, { members: t.members.filter((m) => memberInfo(rm, m)) }))
    .filter((t) => t.members.length);
  const placed = new Set();
  for (const t of list) for (const m of t.members) placed.add(`${m.r}#${m.i}`);
  const fresh = regs.filter((r) => !r.excluded && r.players.every((_, i) => !placed.has(`${r.id}#${i}`)));
  const add = buildTeams(fresh, { rng, strength });
  const used = new Set(list.map((t) => t.name));
  let n = 1;
  for (const t of add) {
    if (t.autoName) {
      while (used.has(`媒合隊伍 ${String(n).padStart(2, '0')}`)) n++;
      t.name = `媒合隊伍 ${String(n++).padStart(2, '0')}`;
    }
    used.add(t.name);
  }
  list = list.concat(add);
  for (const t of list) {
    if (t.cap >= t.members.length) t.cap = 0;
    if (t.members.length !== 3) t.include = false;
  }
  return { teams: list, added: add.length };
}

export function captainNick(t, rm) {
  const m = t.members[t.cap] || t.members[0];
  const info = m ? memberInfo(rm, m) : null;
  return info ? info.nick : '';
}

export function teamLabel(t, rm, mode = 'team') {
  const cap = captainNick(t, rm);
  const name = t.name || (cap ? `${cap}隊` : '未命名隊伍');
  if (mode === 'captain') return cap || name;
  if (mode === 'both') return cap && cap !== name ? `${name}（${cap}）` : name;
  return name;
}

// 交換兩位成員（b.idx 等於隊伍人數時，代表移到那隊的空位）
export function swapMembers(teams, a, b) {
  const list = teams.map((t) => Object.assign({}, t, { members: t.members.slice() }));
  const ta = list.find((t) => t.id === a.team), tb = list.find((t) => t.id === b.team);
  if (!ta || !tb) return teams;
  const ma = ta.members[a.idx];
  if (!ma) return teams;
  if (b.idx >= tb.members.length) {
    if (tb.members.length >= 3) return teams;
    ta.members.splice(a.idx, 1);
    tb.members.push(ma);
  } else {
    const mb = tb.members[b.idx];
    ta.members[a.idx] = mb;
    tb.members[b.idx] = ma;
  }
  for (const t of [ta, tb]) {
    if (t.cap >= t.members.length) t.cap = 0;
    if (t.members.length !== 3) t.include = false;
  }
  return list.filter((t) => t.members.length);
}
