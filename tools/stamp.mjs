// tools/stamp.mjs — 幫所有 js／css 網址加上版本號（?v=…），避免網站更新後瀏覽器混用新舊檔案
// 用法：改完程式後在專案資料夾執行  node tools/stamp.mjs
//       只檢查不修改：              node tools/stamp.mjs --check
// 版本號 = 所有 html／js／css 內容（去掉版本號後）的雜湊，內容沒變就不會變。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n.startsWith('.') || n === 'node_modules' || n === 'tools') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(html|js|css)$/.test(n)) out.push(p);
  }
  return out;
}

// js 裡的 import（靜態與動態），只處理相對路徑
const JS_RE = /((?:\bfrom|\bimport)\s*\(?\s*)(['"])(\.{1,2}\/[^'"?]+\.js)(?:\?v=[^'"]*)?\2/g;
// html 裡的 <script src> 與 <link href>
const HTML_RE = /((?:src|href)=")((?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"/g;
const strip = (s) => s.replace(/\?v=[0-9a-z]+(?=['"])/g, '');

const files = walk(ROOT).sort();
const h = createHash('sha1');
for (const f of files) { h.update(relative(ROOT, f)); h.update(strip(readFileSync(f, 'utf8'))); }
const ver = h.digest('hex').slice(0, 8);

let changed = 0;
const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let out = src;
  if (f.endsWith('.js')) out = src.replace(JS_RE, (m, pre, q, path) => `${pre}${q}${path}?v=${ver}${q}`);
  else if (f.endsWith('.html')) out = src.replace(HTML_RE, (m, pre, path) => `${pre}${path}?v=${ver}"`);
  if (out !== src) {
    if (check) bad.push(relative(ROOT, f));
    else { writeFileSync(f, out); changed++; }
  }
}
if (check) {
  if (bad.length) { console.error(`版本號不是最新（${ver}）：\n  ${bad.join('\n  ')}\n請執行 node tools/stamp.mjs`); process.exit(1); }
  console.log(`版本號 ${ver}：全部正確`);
} else console.log(`版本號 ${ver}：更新了 ${changed} 個檔案`);
