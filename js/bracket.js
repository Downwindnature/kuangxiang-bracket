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
export function createBracket(teamIds, { mode = MODE_ODD, third = true, rng = cryptoRandom } = {}) {
  const ids = teamIds.filter(Boolean);
  const st = makeMask(ids.length, mode);
  if (!st) return null;
  shuffle(ids, rng);
  const leaves = st.mask.map(() => '');
  let p = 0;
  st.mask.forEach((v, i) => { if (v) leaves[i] = ids[p++]; });
  return { v: 1, k: st.k, mode, third: !!third, leaves, m: {} };
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
