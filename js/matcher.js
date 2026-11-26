// matcher.js — 選手抽籤：3 人隊直接成隊，2 人組與 1 人報名隨機媒合成 3 人一隊
import { shuffle, cryptoRandom } from './bracket.js?v=6c54854c';
import { uid } from './util.js?v=6c54854c';

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

export const refKey = (ref) => `${ref.r}#${ref.i}`;

// 人數不是 3 人 → 先不參加抽籤（記下是因為人數）；之後湊回 3 人就自動回到抽籤名單。
// 後台手動取消勾選的隊伍不會被自動加回去。
export function settleTeam(t) {
  if (t.cap >= t.members.length) t.cap = 0;
  if (t.members.length !== 3) {
    if (t.include) { t.include = false; t.autoOff = true; }
  } else if (!t.include && t.autoOff) {
    t.include = true;
    delete t.autoOff;
  }
  return t;
}

// strength(reg, i) 有給的話（後台的平衡設定）：先照原本的方式隨機媒合，再調整成各隊強度比較平均
// skip：設成「無隊伍」的選手（Set of 'r#i'），不會被分進任何隊伍；2 人報名其中一位無隊伍時，另一位當作 1 人報名來媒合
// extra：另外要當作 1 人報名一起媒合的選手（refs）
export function buildTeams(regs, { rng = cryptoRandom, strength = null, skip = null, extra = [] } = {}) {
  const active = regs.filter((r) => !r.excluded);
  const out = (r, i) => !!skip && skip.has(`${r.id}#${i}`);
  const teams = [];
  for (const r of active.filter((x) => x.type === 3)) {
    const members = r.players.map((_, i) => ({ r: r.id, i })).filter((m) => !out(r, m.i));
    if (!members.length) continue;
    teams.push({ id: uid('t_'), name: r.teamName || '', origin: 'self', members, cap: 0, include: members.length === 3, ...(members.length === 3 ? {} : { autoOff: true }) });
  }
  const pairRegs = [], half = [];
  for (const r of active.filter((x) => x.type === 2)) {
    const left = r.players.map((_, i) => i).filter((i) => !out(r, i));
    if (left.length === r.players.length) pairRegs.push(r);
    else if (left.length) half.push(...left.map((i) => ({ r: r.id, i })));
  }
  const pairs = shuffle(pairRegs, rng);
  const singles = shuffle(active.filter((x) => x.type === 1 && !out(x, 0)).map((s) => ({ r: s.id, i: 0 })).concat(half, extra), rng);
  for (const p of pairs) {
    const members = p.players.map((_, i) => ({ r: p.id, i }));
    if (singles.length) members.push(singles.pop());
    teams.push({ id: uid('t_'), name: p.teamName || '', origin: 'matched', members, cap: p.capIdx == null ? 0 : p.capIdx, capPending: p.capIdx == null, include: members.length === 3, ...(members.length === 3 ? {} : { autoOff: true }) });
  }
  while (singles.length >= 3) {
    const g = singles.splice(0, 3);
    teams.push({ id: uid('t_'), name: '', origin: 'matched', members: g, cap: 0, capPending: true, include: true });
  }
  if (singles.length) {
    teams.push({ id: uid('t_'), name: '', origin: 'matched', members: singles, cap: 0, capPending: true, include: false, autoOff: true });
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
// skip：設成「無隊伍」的選手，不會被補進來
export function refreshTeams(teams, regs, { rng = cryptoRandom, strength = null, skip = null } = {}) {
  const rm = regMap(regs.filter((r) => !r.excluded));
  let list = teams.map((t) => Object.assign({}, t, { members: t.members.filter((m) => memberInfo(rm, m)) }))
    .filter((t) => t.members.length);
  const placed = new Set(skip || []);
  for (const t of list) for (const m of t.members) placed.add(`${m.r}#${m.i}`);
  const fresh = regs.filter((r) => !r.excluded && r.players.every((_, i) => !placed.has(`${r.id}#${i}`)));
  // 同一筆報名有人已經在隊伍裡（或無隊伍）、剩下還沒分隊的人：當作 1 人報名補進來
  const loose = [];
  for (const r of regs) {
    if (r.excluded || fresh.includes(r)) continue;
    r.players.forEach((_, i) => { if (!placed.has(`${r.id}#${i}`)) loose.push({ r: r.id, i }); });
  }
  const add = buildTeams(fresh, { rng, strength, extra: loose });
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
  for (const t of list) settleTeam(t);
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
  for (const t of [ta, tb]) settleTeam(t);
  return list.filter((t) => t.members.length);
}

// 單獨移動一位選手（不影響其他人，除非選了交換）：
//   dest = { bench: true }            → 無隊伍（從原本的隊伍拿掉）
//   dest = { team: id }               → 單獨加入那一隊（滿 3 人也可以，會變 4 人、先不參加抽籤，之後再調整）
//   dest = { team: id, swap: idx }    → 跟那一隊第 idx 位交換；對方換到這位原本的位置（原本沒有隊伍 → 對方變無隊伍）
// 人數不是 3 的隊伍先不參加抽籤、湊回 3 人自動回來（settleTeam）；隊長離隊或換人時標成「隊長待確認」。回傳 { teams, bench }
export function movePlayer(teams, bench, ref, dest) {
  const key = refKey(ref);
  const me = { r: ref.r, i: ref.i };
  const list = teams.map((t) => Object.assign({}, t, { members: t.members.slice() }));
  let nb = (bench || []).filter((x) => refKey(x) !== key);
  let from = null, at = -1;
  for (const t of list) { const i = t.members.findIndex((x) => refKey(x) === key); if (i >= 0) { from = t; at = i; break; } }
  const touched = new Set();
  const removeAt = (t, i) => {
    t.members.splice(i, 1);
    if (i < t.cap) t.cap -= 1;
    else if (i === t.cap) { t.cap = 0; t.capPending = true; }
    touched.add(t);
  };
  if (dest.bench) {
    if (from) removeAt(from, at);
    nb.push(me);
  } else {
    const to = list.find((t) => t.id === dest.team);
    if (!to || to === from) return { teams, bench };
    if (dest.swap != null) {
      const other = to.members[dest.swap];
      if (!other) return { teams, bench };
      to.members[dest.swap] = me;
      if (dest.swap === to.cap) to.capPending = true;
      touched.add(to);
      if (from) {
        from.members[at] = other;
        if (at === from.cap) from.capPending = true;
        touched.add(from);
      } else nb.push(other);
    } else {
      if (from) removeAt(from, at);
      to.members.push(me);
      touched.add(to);
    }
  }
  for (const t of touched) settleTeam(t);
  return { teams: list.filter((t) => t.members.length), bench: nb };
}
