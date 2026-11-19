// layout.js — 依隊伍數計算賽程表的版面（純計算，不碰 DOM）
// 左右兩半往中間收：第 1 輪在最外側，準決賽在最內側；冠軍賽在中間上方、季軍賽在中間下方。

export const LAYOUT = {
  boxW: 216,      // 每個對戰框的寬度
  rowH: 30,       // 每一隊一列的高度（框高 = 2 列）
  timeH: 28,      // 框上方時間標籤的高度
  colGap: 56,     // 欄與欄之間（連接線）的寬度
  pitch: 116,     // 最外層每一格的垂直間距
  centerGap: 48,  // 左右兩場準決賽之間的距離
  titleH: 66,     // 冠軍賽／季軍賽大標題的高度
  finalGap: 34,   // 冠軍賽框與準決賽時間標籤之間的距離
  thirdGap: 30,   // 準決賽框與季軍賽時間標籤之間的距離
  pad: 18,
};

export function layoutBracket(A, opt = {}) {
  const P = Object.assign({}, LAYOUT, opt);
  const k = A.k, S = A.S;
  const boxH = P.rowH * 2;
  const pitchX = P.boxW + P.colGap;
  const nCols = k - 1;
  const sideW = nCols > 0 ? nCols * P.boxW + (nCols - 1) * P.colGap : 0;
  const W = k === 1 ? Math.max(P.boxW + 2 * P.pad, 420) : 2 * sideW + P.centerGap;
  const vis = (p) => p >= 1 && p < S && A.nodes[p] && A.nodes[p].visible;
  const visKids = (p) => A.nodes[p].kids.filter((c) => c < S && vis(c));

  const Y = {};     // 節點中心 y（相對）
  const side = {};  // 節點在哪一邊
  if (k >= 2) {
    for (const [root, sd] of [[2, 'L'], [3, 'R']]) {
      if (!vis(root)) continue;
      let slot = 0;
      const take = () => (slot++ + 0.5) * P.pitch;
      const place = (p) => {
        side[p] = sd;
        const vk = visKids(p);
        let y;
        if (vk.length === 0) y = take();
        else if (vk.length === 2) y = (place(vk[0]) + place(vk[1])) / 2;
        else {
          const c = vk[0], s = c % 2; // 偶數子節點餵上面那格
          if (visKids(c).length === 0) {
            y = take();
            side[c] = sd;
            Y[c] = y + (s === 0 ? -P.rowH / 2 : P.rowH / 2); // 跟它要進的那一格對齊
          } else {
            const cy = place(c);
            y = cy + (s === 0 ? P.rowH / 2 : -P.rowH / 2);
          }
        }
        Y[p] = y;
        return y;
      };
      place(root);
      const off = Y[root];
      for (const p of Object.keys(Y)) if (side[p] === sd) Y[p] -= off; // 兩邊的準決賽對齊在 y = 0
    }
  }

  const boxes = [];
  const colX = (round, sd) => {
    const col = round - 1;
    return sd === 'L' ? col * pitchX : W - col * pitchX - P.boxW;
  };
  for (const key of Object.keys(Y)) {
    const p = Number(key), n = A.nodes[p];
    boxes.push({ p, id: n.id, kind: n.type, side: side[p], round: n.round, x: colX(n.round, side[p]), y: Y[p] });
  }

  // 冠軍賽、季軍賽放中間
  const cx = W / 2 - P.boxW / 2;
  const titles = [];
  const finalY = k === 1 ? 0 : -(boxH + P.timeH + P.finalGap);
  boxes.push({ p: 1, id: '1', kind: 'final', side: 'C', round: k, x: cx, y: finalY });
  titles.push({ kind: 'final', text: '冠軍賽', x: W / 2, top: finalY - boxH / 2 - P.titleH, h: P.titleH, timeFor: '1' });
  if (A.third) {
    const top = boxH / 2 + P.thirdGap + P.timeH;
    const ty = top + P.titleH + boxH / 2;
    boxes.push({ p: 'T', id: 'T', kind: 'third', side: 'C', round: k, x: cx, y: ty });
    titles.push({ kind: 'third', text: '季軍賽', x: W / 2, top, h: P.titleH, timeFor: 'T' });
  }

  // 連接線：子框內側 → 中線 → 父框的對應那一格
  const lines = [];
  const byId = {};
  for (const b of boxes) byId[b.id] = b;
  for (const b of boxes) {
    if (b.kind === 'final' || b.kind === 'third') continue;
    const p = b.p;
    if (p === 2 || p === 3) continue; // 準決賽 → 冠軍賽不畫線（照設計稿）
    const par = byId[String(p >> 1)];
    if (!par) continue;
    const s = p % 2;
    const slotY = par.y + (s === 0 ? -P.rowH / 2 : P.rowH / 2);
    const n = A.nodes[p];
    const state = n.done ? 'done' : '';
    if (b.side === 'L') {
      const x0 = b.x + P.boxW, xm = x0 + P.colGap / 2, x1 = par.x;
      lines.push({ from: p, to: par.p, state, pts: [[x0, b.y], [xm, b.y], [xm, slotY], [x1, slotY]] });
    } else {
      const x0 = b.x, xm = x0 - P.colGap / 2, x1 = par.x + P.boxW;
      lines.push({ from: p, to: par.p, state, pts: [[x0, b.y], [xm, b.y], [xm, slotY], [x1, slotY]] });
    }
  }

  // 計算外框，整體往下平移到從 pad 開始
  let minT = Infinity, maxB = -Infinity;
  for (const b of boxes) {
    minT = Math.min(minT, b.y - boxH / 2 - P.timeH);
    maxB = Math.max(maxB, b.y + boxH / 2);
  }
  for (const t of titles) {
    minT = Math.min(minT, t.top - P.timeH);
    maxB = Math.max(maxB, t.top + t.h);
  }
  const shift = P.pad - minT;
  for (const b of boxes) b.y += shift;
  for (const t of titles) t.top += shift;
  for (const l of lines) l.pts = l.pts.map(([x, y]) => [x, y + shift]);
  const H = maxB - minT + 2 * P.pad;

  return { W, H, boxes, lines, titles, P, boxH };
}
