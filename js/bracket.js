// bracket.js — 單淘汰賽程引擎（純函式：前台、後台、測試共用）
//
// 賽程用「完整二元樹」表示：葉子數 S = 2^k，leaves[i] 放隊伍 id（'' 代表空位）。
// 節點編號採 heap 順序：1 = 冠軍賽，2 / 3 = 左右兩邊的準決賽，節點 p 的子節點是 2p、2p+1，
// 葉子節點是 S .. 2S-1（第 i 個葉子 = 節點 S+i）。
// 任何一邊沒有隊伍的節點就是「輪空」：另一邊的隊伍（或勝隊）自動晉級。

export const MODE_ODD = 'odd';   // 依比賽規則 二-3：每一輪隊伍數為單數時，抽 1 隊輪空直接晉級
export const MODE_POW2 = 'pow2'; // 補滿到 2 的次方：輪空全部集中在第 1 輪
export const THIRD = 'T';        // 季軍賽的場次編號
export const MAX_TEAMS = 128;

export function heightFor(n) {
  let k = 1;
  while ((1 << k) < n) k++;
  return k;
}

// 依隊伍數與輪空方式算出結構：mask[i] = 1 代表第 i 個葉子要放一隊
export function makeMask(n, mode = MODE_ODD) {
  if (!(n >= 2)) return null;
  const k = heightFor(n), S = 1 << k;
  const mask = new Array(S).fill(0);
  if (mode === MODE_POW2) {
    const fill = (start, size, cnt) => {
      if (size === 1) { mask[start] = cnt ? 1 : 0; return; }
      const half = size >> 1, a = Math.ceil(cnt / 2);
      fill(start, half, a);
      fill(start + half, half, cnt - a);
    };
    fill(0, S, n);
  } else {
    const embed = (u, p) => {
      if (u.leaf) { mask[p - S] = 1; return; }
      embed(u.kids[0], 2 * p);
      if (u.kids[1]) embed(u.kids[1], 2 * p + 1);
    };
    embed(oddTree(n), 1);
  }
  return { k, mask };
}

// 每輪單數就輪空 1 隊；優先讓「還沒輪空過」且隊伍較少的分支輪空，兩邊盡量平均
function oddTree(n) {
  let units = [];
  for (let i = 0; i < n; i++) units.push({ leaf: true, size: 1, byes: 0 });
  while (units.length > 1) {
    let bye = null;
    if (units.length % 2) {
      let bi = 0;
      for (let i = 1; i < units.length; i++) {
        const u = units[i], b = units[bi];
        if (u.byes < b.byes || (u.byes === b.byes && u.size < b.size)) bi = i;
      }
      bye = units.splice(bi, 1)[0];
    }
    const sorted = units.slice().sort((a, b) => b.size - a.size);
    const next = [];
    for (let i = 0, j = sorted.length - 1; i < j; i++, j--) {
      const a = sorted[i], b = sorted[j];
      next.push({ kids: [a, b], size: a.size + b.size, byes: a.byes + b.byes });
    }
    if (bye) next.push({ kids: [bye], size: bye.size, byes: bye.byes + 1 });
    units = next;
  }
  return units[0];
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export function cryptoRandom() {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  }
  return Math.random();
}

export function clone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}

// 建立賽程（抽籤）：隊伍隨機放進結構裡的位置
// strength(id) 有給的話（後台的平衡設定）：輪空的隊伍一樣隨機抽；每一隊的「第一場」盡量對上強度相近的對手
// —— 第一輪兩兩配對看差距，輪空的隊伍則看它第一場會碰到的那一邊。符合的安排裡隨機挑，保留抽籤的隨機性。
export function createBracket(teamIds, { mode = MODE_ODD, third = true, rng = cryptoRandom, strength = null, maxGap = 1 } = {}) {
  const ids = teamIds.filter(Boolean);
  const st = makeMask(ids.length, mode);
  if (!st) return null;
  const leaves = st.mask.map(() => '');
  const known = strength ? ids.filter((id) => isNum(strength(id))).length : 0;
  if (known >= 2) {
    const val = strengthMap(ids, strength);
    const { pairs, solos } = firstRoundSlots(st.mask);
    const pool = shuffle(ids.slice(), rng);
    const byes = pool.splice(0, solos.length);        // 輪空：照規則隨機
    const matches = pairByStrength(pool, (id) => val.get(id), maxGap, rng);
    placeFirstRound(st.mask, pairs, solos, matches, byes, val, maxGap, rng).forEach((id, i) => { if (id) leaves[i] = id; });
  } else {
    shuffle(ids, rng);
    let p = 0;
    st.mask.forEach((v, i) => { if (v) leaves[i] = ids[p++]; });
  }
  return { v: 1, k: st.k, mode, third: !!third, leaves, m: {} };
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const EPS = 1e-9;
// 超過上限的部分才算代價，而且平方：兩場各超一點，比一場超很多好
const over = (g, G) => (g > G + EPS ? (g - G) * (g - G) : 0);

// 沒有強度的隊伍當作平均值
function strengthMap(ids, strength) {
  const raw = ids.map((id) => strength(id));
  const known = raw.filter(isNum);
  const avg = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 0;
  return new Map(ids.map((id, i) => [id, isNum(raw[i]) ? raw[i] : avg]));
}

// 第一輪的位置：兩格都有隊伍 = 一場比賽；只有一格 = 輪空
export function firstRoundSlots(mask) {
  const pairs = [], solos = [];
  for (let i = 0; i < mask.length; i += 2) {
    if (mask[i] && mask[i + 1]) pairs.push([i, i + 1]);
    else if (mask[i]) solos.push(i);
    else if (mask[i + 1]) solos.push(i + 1);
  }
  return { pairs, solos };
}

// 兩兩配對：每一對的強度差盡量不超過 maxGap，符合的對象裡隨機挑（保留抽籤的隨機性）。
// 做法：先處理「能配的對象最少」的隊伍，再兩對兩對互換改善；排序後相鄰配對是理論上最好的結果，
// 隨機試到跟它一樣好就停，真的試不到才用它。
export function pairByStrength(ids, strength, maxGap = 1, rng = cryptoRandom, tries = 0) {
  const n = ids.length;
  if (n < 2) return [];
  const val = strengthMap(ids, strength);
  const gap = (a, b) => Math.abs(val.get(a) - val.get(b));
  const cost = (a, b) => over(gap(a, b), maxGap);
  const total = (pairs) => pairs.reduce((s, [a, b]) => s + cost(a, b), 0);
  const sorted = ids.slice().sort((a, b) => val.get(a) - val.get(b));
  const floor = [];
  for (let i = 0; i + 1 < n; i += 2) floor.push([sorted[i], sorted[i + 1]]);
  const target = total(floor) + EPS;
  const rounds = tries || (n <= 32 ? 60 : n <= 64 ? 25 : 10);
  let best = null;
  for (let t = 0; t < rounds; t++) {
    const pairs = improvePairs(greedyPairs(shuffle(ids.slice(), rng), gap, maxGap, rng), cost);
    const c = total(pairs);
    if (!best || c < best.c - EPS) best = { pairs, c };
    if (best.c <= target) break;
  }
  return best.c <= target ? best.pairs : floor;
}

function greedyPairs(pool, gap, G, rng) {
  const ok = (a, b) => gap(a, b) <= G + EPS;
  const pairs = [];
  while (pool.length > 1) {
    let ai = 0, least = Infinity;
    for (let i = 0; i < pool.length; i++) {
      let c = 0;
      for (let j = 0; j < pool.length; j++) if (j !== i && ok(pool[i], pool[j])) c++;
      if (c < least) { least = c; ai = i; }
    }
    const a = pool.splice(ai, 1)[0];
    const cand = pool.filter((x) => ok(a, x));
    const b = cand.length ? cand[Math.floor(rng() * cand.length)] : pool.reduce((m, x) => (gap(a, x) < gap(a, m) ? x : m), pool[0]);
    pool.splice(pool.indexOf(b), 1);
    pairs.push([a, b]);
  }
  return pairs;
}

function improvePairs(pairs, cost) {
  for (let guard = 0, again = true; again && guard < 40; guard++) {
    again = false;
    for (let i = 0; i < pairs.length; i++) {
      for (let j = i + 1; j < pairs.length; j++) {
        const [a, b] = pairs[i], [c, d] = pairs[j];
        const now = cost(a, b) + cost(c, d);
        if (now <= EPS) continue;
        const x = cost(a, c) + cost(b, d), y = cost(a, d) + cost(b, c);
        if (x < now - EPS && x <= y) { pairs[i] = [a, c]; pairs[j] = [b, d]; again = true; }
        else if (y < now - EPS) { pairs[i] = [a, d]; pairs[j] = [b, c]; again = true; }
      }
    }
  }
  return pairs;
}

// 把配好的比賽和輪空隊伍放進位置：輪空隊伍第一場會碰到的那一邊（通常是旁邊某一場的勝方）也盡量強度相近。
// 從隨機的擺法開始，只在有超過上限時才互換位置改善；回傳 leaves（每一格的隊伍 id）
function placeFirstRound(mask, pairs, solos, matches, byes, val, G, rng) {
  const S = mask.length;
  const out = mask.map(() => '');
  const put = (mAt, bAt) => {
    pairs.forEach(([x, y], j) => {
      const m = matches[mAt[j]];
      const flip = rng() < 0.5;
      out[x] = flip ? m[1] : m[0];
      out[y] = flip ? m[0] : m[1];
    });
    solos.forEach((x, s) => { out[x] = byes[bAt[s]]; });
    return out;
  };
  const order = (len) => shuffle(Array.from({ length: len }, (_, i) => i), rng);
  if (!solos.length) return put(order(pairs.length), []);
  // 每個節點底下有幾隊；每個輪空位置往上找，第一個有隊伍的另一邊 = 它第一場的對手那一邊
  const cnt = new Array(2 * S).fill(0);
  for (let i = 0; i < S; i++) cnt[S + i] = mask[i] ? 1 : 0;
  for (let p = S - 1; p >= 1; p--) cnt[p] = cnt[2 * p] + cnt[2 * p + 1];
  const pairOf = new Map(pairs.map(([x], j) => [x, j]));
  const soloOf = new Map(solos.map((x, s) => [x, s]));
  const opp = solos.map((x) => {
    let node = S + x;
    while (node > 1 && !cnt[node ^ 1]) node >>= 1;
    if (node <= 1) return { p: [], s: [] };
    const ref = { p: [], s: [] };
    const walk = (q) => {
      if (!cnt[q]) return;
      if (q >= S) { const i = q - S; if (pairOf.has(i)) ref.p.push(pairOf.get(i)); else if (soloOf.has(i)) ref.s.push(soloOf.get(i)); return; }
      walk(2 * q); walk(2 * q + 1);
    };
    walk(node ^ 1);
    return ref;
  });
  const depP = pairs.map(() => []), depS = solos.map((_, s) => [s]);
  opp.forEach((o, s) => { o.p.forEach((j) => depP[j].push(s)); o.s.forEach((t) => depS[t].push(s)); });
  const mv = matches.map(([a, b]) => val.get(a) + val.get(b));
  const one = (s, mAt, bAt) => {
    const o = opp[s];
    let sum = 0, k = 0;
    for (const j of o.p) { sum += mv[mAt[j]]; k += 2; }
    for (const t of o.s) { sum += val.get(byes[bAt[t]]); k += 1; }
    return k ? over(Math.abs(val.get(byes[bAt[s]]) - sum / k), G) : 0;
  };
  const some = (list, mAt, bAt) => { let c = 0; for (const s of new Set(list)) c += one(s, mAt, bAt); return c; };
  const all = (mAt, bAt) => solos.reduce((c, _, s) => c + one(s, mAt, bAt), 0);
  const tryPairs = (mAt, bAt) => {
    let gain = false;
    for (let a = 0; a < mAt.length; a++) {
      for (let b = a + 1; b < mAt.length; b++) {
        const dep = depP[a].concat(depP[b]);
        if (!dep.length) continue;
        const before = some(dep, mAt, bAt);
        if (before <= EPS) continue;
        [mAt[a], mAt[b]] = [mAt[b], mAt[a]];
        if (some(dep, mAt, bAt) < before - EPS) gain = true; else [mAt[a], mAt[b]] = [mAt[b], mAt[a]];
      }
    }
    return gain;
  };
  const trySolos = (mAt, bAt) => {
    let gain = false;
    for (let a = 0; a < bAt.length; a++) {
      for (let b = a + 1; b < bAt.length; b++) {
        const dep = depS[a].concat(depS[b]);
        const before = some(dep, mAt, bAt);
        if (before <= EPS) continue;
        [bAt[a], bAt[b]] = [bAt[b], bAt[a]];
        if (some(dep, mAt, bAt) < before - EPS) gain = true; else [bAt[a], bAt[b]] = [bAt[b], bAt[a]];
      }
    }
    return gain;
  };
  let best = null;
  const restarts = solos.length + pairs.length <= 40 ? 12 : 5;
  for (let r = 0; r < restarts; r++) {
    const mAt = order(pairs.length), bAt = order(solos.length);
    for (let guard = 0; guard < 30 && all(mAt, bAt) > EPS; guard++) {
      const g1 = tryPairs(mAt, bAt);
      const g2 = trySolos(mAt, bAt);
      if (!g1 && !g2) break;
    }
    const c = all(mAt, bAt);
    if (!best || c < best.c - EPS) best = { mAt, bAt, c };
    if (best.c <= EPS) break;
  }
  return put(best.mAt, best.bAt);
}

const isTeam = (x) => typeof x === 'string' && x !== '' && x !== '?';

// 分析賽程：每個節點的類型（match / bye / empty）、參賽者、勝負、是否顯示
// fix = true 時會順便清掉已經不成立的結果（例如下層改判後，上層的勝方已不是同一隊）
export function analyze(br, { fix = false } = {}) {
  const k = br.k, S = 1 << k;
  const m = br.m || (br.m = {});
  const nonEmpty = new Array(2 * S).fill(false);
  const win = new Array(2 * S);
  for (let p = S; p < 2 * S; p++) {
    const t = br.leaves[p - S] || '';
    nonEmpty[p] = t !== '';
    win[p] = t === '' ? null : t;
  }
  for (let p = S - 1; p >= 1; p--) nonEmpty[p] = nonEmpty[2 * p] || nonEmpty[2 * p + 1];

  const nodes = {};
  let changed = false;
  for (let p = S - 1; p >= 1; p--) {
    const a = 2 * p, b = a + 1;
    const round = k - Math.floor(Math.log2(p));
    const n = { p, id: String(p), round, kids: [a, b], ent: [win[a], win[b]], src: [srcLeaf(a), srcLeaf(b)] };
    const r = m[p];
    if (!nonEmpty[a] && !nonEmpty[b]) {
      n.type = 'empty'; win[p] = null;
    } else if (!nonEmpty[a] || !nonEmpty[b]) {
      n.type = 'bye';
      const c = nonEmpty[a] ? a : b;
      n.live = nonEmpty[a] ? 0 : 1;           // 有隊伍的那一格
      n.leafBye = c >= S;                      // 葉子層的輪空（直接把隊伍放進上一場）
      win[p] = win[c];
      if (r && (r.w != null || r.s)) { if (fix) { delete r.w; delete r.wid; delete r.s; } changed = true; }
    } else {
      n.type = 'match';
      const [x, y] = n.ent;
      n.ready = isTeam(x) && isTeam(y);
      let ok = false;
      if (r && (r.w === 0 || r.w === 1)) {
        ok = n.ready && r.wid === n.ent[r.w];
        if (!ok) { if (fix) { delete r.w; delete r.wid; delete r.s; } changed = true; }
      } else if (r && r.s && !n.ready) {
        if (fix) delete r.s;
        changed = true;
      }
      if (ok) {
        n.w = r.w; n.winner = n.ent[r.w]; n.loser = n.ent[1 - r.w]; n.done = true;
        win[p] = n.winner;
      } else {
        win[p] = undefined; // 待定
      }
    }
    n.time = (r && r.t) || '';
    n.score = (r && r.s) || null;
    n.visible = n.type === 'match' || (n.type === 'bye' && !n.leafBye);
    nodes[p] = n;
  }

  // 葉子來源：這一格的隊伍是直接從哪個葉子來的（供後台手動交換位置）
  function srcLeaf(c) {
    if (c >= S) return nonEmpty[c] ? c - S : null;
    // 葉子層輪空：隊伍直接放進上一場
    const l = 2 * c, r = l + 1;
    if (l >= S && (nonEmpty[l] !== nonEmpty[r])) return nonEmpty[l] ? l - S : r - S;
    return null;
  }

  // 季軍賽：兩場準決賽都要是真正的比賽
  let third = null;
  if (br.third && k >= 2 && nodes[2] && nodes[3] && nodes[2].type === 'match' && nodes[3].type === 'match') {
    const ent = [nodes[2].done ? nodes[2].loser : undefined, nodes[3].done ? nodes[3].loser : undefined];
    third = { p: THIRD, id: THIRD, round: k, type: 'match', kids: [2, 3], ent, src: [null, null], third: true };
    third.ready = isTeam(ent[0]) && isTeam(ent[1]);
    const r = m[THIRD];
    third.time = (r && r.t) || '';
    third.score = (r && r.s) || null;
    if (r && (r.w === 0 || r.w === 1)) {
      if (third.ready && r.wid === ent[r.w]) {
        third.w = r.w; third.winner = ent[r.w]; third.loser = ent[1 - r.w]; third.done = true;
      } else { if (fix) { delete r.w; delete r.wid; delete r.s; } changed = true; }
    } else if (r && r.s && !third.ready) { if (fix) delete r.s; changed = true; }
    third.visible = true;
  }

  const root = nodes[1];
  const champion = root && root.done ? root.winner : null;
  const runnerUp = root && root.done ? root.loser : null;
  const thirdPlace = third && third.done ? third.winner : null;
  return { k, S, nodes, third, champion, runnerUp, thirdPlace, changed, nonEmpty };
}

export function getNode(A, id) {
  if (id === THIRD || id === 'T') return A.third;
  return A.nodes[Number(id)] || null;
}

// 列出所有真正的比賽（含季軍賽）
export function allMatches(A) {
  const out = [];
  for (let p = A.S - 1; p >= 1; p--) if (A.nodes[p].type === 'match') out.push(A.nodes[p]);
  out.sort((a, b) => a.round - b.round || a.p - b.p);
  if (A.third) {
    const i = out.findIndex((n) => n.p === 1);
    out.splice(i < 0 ? out.length : i, 0, A.third);
  }
  return out;
}

export function timeKey(t, evening) {
  const mm = /^(\d{1,2})[:：](\d{2})$/.exec(String(t || '').trim());
  if (!mm) return Infinity;
  let v = Number(mm[1]) * 60 + Number(mm[2]);
  if (evening && v < 8 * 60) v += 24 * 60; // 跨過午夜（例如 21:00 → 01:00）
  return v;
}

// 比賽順序：有時間的照時間（支援跨午夜），其次輪次、位置
export function playOrder(A) {
  const list = allMatches(A);
  const evening = list.some((n) => timeKey(n.time) >= 17 * 60);
  return list
    .map((n, i) => ({ n, i, t: timeKey(n.time, evening) }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.n);
}

// 自動找下一場：還沒打、兩邊隊伍都確定、而且不是目前這場
export function nextMatch(A, currentId) {
  for (const n of playOrder(A)) {
    if (n.done || !n.ready) continue;
    if (currentId != null && String(n.id) === String(currentId)) continue;
    return n;
  }
  return null;
}

// 每一輪實際有幾隊參加
export function roundCounts(A) {
  const counts = [];
  for (let r = 1; r <= A.k; r++) {
    let c = 0;
    const from = 1 << (A.k - r + 1), to = from << 1; // 第 r 輪的子節點層
    for (let p = from; p < to; p++) if (A.nonEmpty[p]) c++;
    counts[r] = c;
  }
  return counts;
}

const STRONG = { 4: '四強賽', 8: '八強賽', 16: '十六強賽', 32: '三十二強賽', 64: '六十四強賽', 128: '一百二十八強賽' };

export function roundNames(A) {
  const counts = roundCounts(A);
  const names = [];
  for (let r = 1; r <= A.k; r++) {
    if (r === A.k) names[r] = '冠軍賽';
    else names[r] = STRONG[counts[r]] || `第 ${r} 輪`;
  }
  return names;
}

export function matchTitle(A, n) {
  if (!n) return '';
  if (n.third) return '季軍賽';
  return roundNames(A)[n.round];
}

// 每輪輪空的情況（後台提示用）
export function byeSummary(A) {
  const out = [];
  for (let r = 1; r <= A.k; r++) out[r] = [];
  for (let p = A.S - 1; p >= 1; p--) {
    const n = A.nodes[p];
    if (n.type === 'bye') out[n.round].push(n);
  }
  return out;
}

export function teamCount(br) {
  return br ? br.leaves.filter((x) => x && x !== '?').length : 0;
}

// ── 修改（都回傳新的賽程物件，並自動清掉連帶失效的結果）──

function finish(br) {
  analyze(br, { fix: true });
  return br;
}

export function setResult(br0, id, w, scores) {
  const br = clone(br0);
  const A = analyze(br);
  const n = getNode(A, id);
  if (!n || n.type !== 'match' || !n.ready) throw new Error('這場比賽的隊伍還沒確定');
  const key = n.third ? THIRD : n.p;
  const r = br.m[key] || (br.m[key] = {});
  r.w = w; r.wid = n.ent[w];
  if (scores) r.s = [scoreVal(scores[0]), scoreVal(scores[1])];
  return finish(br);
}

export function clearResult(br0, id) {
  const br = clone(br0);
  const key = id === THIRD || id === 'T' ? THIRD : Number(id);
  if (br.m[key]) { delete br.m[key].w; delete br.m[key].wid; }
  return finish(br);
}

export function setScores(br0, id, scores) {
  const br = clone(br0);
  const key = id === THIRD || id === 'T' ? THIRD : Number(id);
  const r = br.m[key] || (br.m[key] = {});
  r.s = [scoreVal(scores[0]), scoreVal(scores[1])];
  if (r.s[0] === '' && r.s[1] === '') delete r.s;
  return finish(br);
}

export function setTime(br0, id, t) {
  const br = clone(br0);
  const key = id === THIRD || id === 'T' ? THIRD : Number(id);
  const r = br.m[key] || (br.m[key] = {});
  const v = String(t || '').trim().replace('：', ':');
  if (v) r.t = v; else delete r.t;
  return br;
}

export function swapLeaves(br0, i, j) {
  const br = clone(br0);
  const t = br.leaves[i]; br.leaves[i] = br.leaves[j]; br.leaves[j] = t;
  return finish(br);
}

export function replaceTeam(br0, oldId, newId) {
  const br = clone(br0);
  br.leaves = br.leaves.map((x) => (x === oldId ? newId : x));
  return finish(br);
}

function scoreVal(v) {
  if (v === '' || v == null) return '';
  const s = String(v).trim();
  return /^-?\d+$/.test(s) ? Number(s) : s;
}

// 依時間順序自動填時間標籤：start = '21:00'，every = 每場間隔分鐘；sameRound = 同一輪同時開打
export function autoTimes(br0, { start = '21:00', every = 30, sameRound = false } = {}) {
  let br = clone(br0);
  const A = analyze(br);
  const mm = /^(\d{1,2})[:：](\d{2})$/.exec(start.trim());
  if (!mm) throw new Error('起始時間格式要像 21:00');
  let t = Number(mm[1]) * 60 + Number(mm[2]);
  const fmt = (v) => `${String(Math.floor(v / 60) % 24).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  const list = allMatches(A);
  let lastRound = null;
  list.forEach((n, i) => {
    if (sameRound) {
      const r = n.third ? A.k - 0.5 : n.round;
      if (lastRound !== null && r !== lastRound) t += every;
      lastRound = r;
    } else if (i > 0) t += every;
    const key = n.third ? THIRD : n.p;
    const rr = br.m[key] || (br.m[key] = {});
    rr.t = fmt(t);
  });
  return br;
}

// 有沒有已登錄的比賽結果（勝方或比分）
export function hasResults(br) {
  if (!br) return false;
  return Object.values(br.m || {}).some((x) => x && (x.w === 0 || x.w === 1 || (Array.isArray(x.s) && x.s.some((v) => v !== '' && v != null))));
}

// 清掉所有勝負與比分（保留每場的時間）
export function clearAllResults(br0) {
  const br = clone(br0);
  for (const [k, x] of Object.entries(br.m || {})) {
    if (!x) continue;
    delete x.w;
    delete x.wid;
    delete x.s;
    if (!Object.keys(x).length) delete br.m[k];
  }
  return br;
}

// 直播抽籤的揭曉順序：每一步抽出「會直接對戰的兩隊」（依位置：先左半邊由上到下，再右半邊），
// 第一場就要對上勝隊的隊伍（第 1 輪輪空）沒有直接的對手，留到最後一起揭曉
export function revealSteps(br) {
  if (!br) return [];
  const A = analyze({ k: br.k, leaves: br.leaves, m: {}, third: false });
  const pairs = [];
  const used = new Set();
  for (let p = 1; p < A.S; p++) {
    const n = A.nodes[p];
    if (n.type !== 'match') continue;
    const [a, b] = n.src;
    if (a == null || b == null) continue;
    pairs.push([a, b]);
    used.add(a); used.add(b);
  }
  pairs.sort((x, y) => x[0] - y[0]);
  const solos = [];
  br.leaves.forEach((x, i) => { if (x && !used.has(i)) solos.push(i); });
  const steps = pairs.map((l) => ({ l, pair: true }));
  if (solos.length) steps.push({ l: solos, pair: false });
  return steps;
}

// 揭曉進度 → 已經揭曉的葉子（null = 沒有在揭曉，全部公開）
export function revealedSet(reveal) {
  if (!reveal) return null;
  const shown = reveal.shown || 0;
  if (Array.isArray(reveal.steps)) {
    const s = new Set();
    reveal.steps.slice(0, shown).forEach((st) => (st.l || []).forEach((i) => s.add(i)));
    return s;
  }
  if (Array.isArray(reveal.order)) return new Set(reveal.order.slice(0, shown)); // 舊版：一次揭曉一隊
  return null;
}

export function revealPending(reveal) {
  if (!reveal) return false;
  const list = Array.isArray(reveal.steps) ? reveal.steps : reveal.order || [];
  return (reveal.shown || 0) < list.length;
}

// 給前台用的精簡版本（隱藏還沒揭曉的隊伍）
export function publicView(br, names, reveal) {
  if (!br) return null;
  const leaves = br.leaves.slice();
  const shown = revealedSet(reveal);
  if (shown) leaves.forEach((x, i) => { if (x && !shown.has(i)) leaves[i] = '?'; });
  const usedNames = {};
  leaves.forEach((x) => { if (isTeam(x)) usedNames[x] = names[x] || '未命名隊伍'; });
  const m = {};
  for (const [key, r] of Object.entries(br.m || {})) {
    const o = {};
    if (r.t) o.t = r.t;
    if (r.s) o.s = r.s;
    if (r.w === 0 || r.w === 1) { o.w = r.w; o.wid = r.wid; }
    if (Object.keys(o).length) m[key] = o;
  }
  return { v: 1, k: br.k, mode: br.mode, third: !!br.third, leaves, m, names: usedNames, revealing: revealPending(reveal) };
}
