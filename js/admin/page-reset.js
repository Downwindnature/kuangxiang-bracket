// admin/page-reset.js — 重置（有「返回」可以復原）與還原紀錄
import { S, resetAll, listHistory, restoreHistory, deleteHistory, latestResetSnapshot } from './state.js?v=2628f905';
import { esc, fmtDateTime } from '../util.js?v=2628f905';
import { toast, confirmDlg, pageHead } from './ui.js?v=2628f905';

export async function undoLastReset(after) {
  const h = await latestResetSnapshot();
  if (!h) { toast('找不到重置前的備份', { type: 'warn' }); return; }
  await restoreHistory(h.key);
  toast(`已返回：復原到 ${fmtDateTime(h.at)} 重置前的資料`, { ms: 5000 });
  after && after();
}

export function render(main) {
  main.innerHTML = `
    ${pageHead('重置', 'reset')}
    <section class="card danger-card" id="rsReset">
      <h3>重置所有選手資料</h3>
      <p>會清空：<b>報名資料</b>（表單匯入）、<b>組好的隊伍</b>、<b>抽籤結果與賽程比分</b>。前台顯示屏上的選手資料也會一起消失，變回空白。</p>
      <p class="hint">不會清空：顯示屏的文字與外觀設定、Google 同步設定、玩家名冊。</p>
      <div class="btns">
        <button id="doReset" class="danger big">重置所有選手資料</button>
        <button id="undo" class="big">↩ 返回（復原到重置前）</button>
      </div>
      <p class="hint" id="undoInfo"></p>
    </section>
    <section class="card" id="rsHist">
      <h3>還原紀錄</h3>
      <p class="hint">重置、匯入、同步、重新媒合、重新抽籤之前都會自動備份（最多保留 ${S.store.mode === 'local' ? 12 : 30} 筆）。也可以還原到任何一個時間點。</p>
      <div class="tbl-wrap"><table class="tbl" id="hist"><tbody><tr><td class="dim">讀取中…</td></tr></tbody></table></div>
    </section>`;
  const q = (id) => main.querySelector('#' + id);
  const refresh = async () => {
    let list = [];
    try { list = await listHistory(); } catch (e) { q('hist').innerHTML = `<tbody><tr><td class="err">讀取失敗：${esc(e.message)}</td></tr></tbody>`; return; }
    const lastReset = list.find((h) => h.reason === '重置前');
    q('undo').disabled = !lastReset;
    q('undoInfo').textContent = lastReset ? `最近一次重置：${fmtDateTime(lastReset.at)}（當時有報名 ${lastReset.regs} 筆、隊伍 ${lastReset.teams} 隊、賽程 ${lastReset.bracket} 隊）` : '目前沒有重置紀錄。';
    q('hist').innerHTML = list.length ? `<thead><tr><th>時間</th><th>動作</th><th>當時的資料</th><th></th></tr></thead><tbody>${list.map((h) => `
      <tr><td class="nowrap">${esc(fmtDateTime(h.at))}</td><td>${esc(h.reason)}</td>
      <td>報名 ${h.regs} 筆、隊伍 ${h.teams} 隊、賽程 ${h.bracket} 隊${h.published ? '（已公布）' : ''}</td>
      <td class="nowrap"><button data-restore="${esc(h.key)}">還原</button> <button class="ghost" data-del="${esc(h.key)}">刪除</button></td></tr>`).join('')}</tbody>` : '<tbody><tr><td class="dim">還沒有備份紀錄。</td></tr></tbody>';
  };
  refresh();
  q('doReset').onclick = async () => {
    const ok = await confirmDlg(`確定要重置嗎？\n\n目前：報名 ${S.regs.length} 筆、隊伍 ${S.teams.length} 隊${S.bracket ? '、已抽籤' : ''}。\n重置後前台會變回空白。誤按的話可以按「返回」復原。`, { danger: true, ok: '重置', title: '重置所有選手資料' });
    if (!ok) return;
    await resetAll();
    toast('已重置，前台已清空', { ms: 8000, action: { label: '返回', fn: () => undoLastReset(() => render(main)) } });
    render(main);
  };
  q('undo').onclick = () => undoLastReset(() => render(main));
  q('hist').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-restore]');
    const d = e.target.closest('[data-del]');
    if (r) {
      if (!(await confirmDlg('還原到這個時間點？目前的資料會先自動備份。'))) return;
      try {
        const h = await restoreHistory(r.dataset.restore);
        toast(`已還原到 ${fmtDateTime(h.at)}（${h.reason}）`);
        render(main);
      } catch (err) { toast(err.message, { type: 'err' }); }
    } else if (d) {
      if (!(await confirmDlg('刪除這筆備份？刪除後就不能還原到這個時間點。', { danger: true, ok: '刪除' }))) return;
      await deleteHistory(d.dataset.del);
      refresh();
    }
  });
}
