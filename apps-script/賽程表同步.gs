/**
 * 狂想之息賽程表｜Google 表單同步
 * 讓賽程表後台「表單匯入 → 從 Google 表單同步」可以直接讀到報名表的所有回覆。
 *
 * 使用方式（只要做一次）：
 * 1. 把這個檔案放進 Apps Script 專案「狂想之息報名表產生器」（檔案 → ＋ → 指令碼，取名「賽程表同步」）。
 * 2. 上方函式選單選 setupBracketSync → ▷ 執行 → 下方「執行紀錄」會顯示同步金鑰。
 * 3. 部署 → 新增部署作業 → 類型「網頁應用程式」→ 執行身分「我」、存取權「所有人」→ 部署 → 複製網址。
 * 4. 到賽程表後台「表單匯入 → 同步設定」貼上網址與金鑰。
 *
 * 安全性：沒有正確金鑰的請求只會得到 {"ok":false,"error":"unauthorized"}，看不到任何報名資料。
 * 要換金鑰：執行 resetBracketSyncKey，再把新金鑰貼到後台。
 */
var KXB_FORM_ID = '1N2I8G4S90Fe9Rem6gIXgy0Kr6FPi7z70ZBV_ptsPIHM';

function setupBracketSync() {
  var props = PropertiesService.getScriptProperties();
  var key = props.getProperty('KXB_SYNC_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    props.setProperty('KXB_SYNC_KEY', key);
  }
  var form = FormApp.openById(KXB_FORM_ID);
  Logger.log('表單：' + form.getTitle() + '（目前 ' + form.getResponses().length + ' 筆回覆）');
  Logger.log('同步金鑰（貼到賽程表後台）：' + key);
}

function resetBracketSyncKey() {
  PropertiesService.getScriptProperties().deleteProperty('KXB_SYNC_KEY');
  setupBracketSync();
}

function doGet(e) {
  var key = PropertiesService.getScriptProperties().getProperty('KXB_SYNC_KEY');
  var given = e && e.parameter ? e.parameter.key : '';
  if (!key || given !== key) return kxbJson_({ ok: false, error: 'unauthorized' });
  var form = FormApp.openById(KXB_FORM_ID);
  var skip = [FormApp.ItemType.SECTION_HEADER, FormApp.ItemType.PAGE_BREAK, FormApp.ItemType.IMAGE, FormApp.ItemType.VIDEO];
  var columns = [];
  form.getItems().forEach(function (it) {
    if (skip.indexOf(it.getType()) >= 0) return;
    columns.push(it.getTitle());
  });
  var rows = form.getResponses().map(function (r) {
    var values = {};
    r.getItemResponses().forEach(function (ir) {
      var v = ir.getResponse();
      if (Array.isArray(v)) v = v.map(function (x) { return Array.isArray(x) ? x.join('/') : x; }).join(', ');
      values[ir.getItem().getTitle()] = v == null ? '' : String(v);
    });
    return { id: r.getId(), ts: r.getTimestamp().toISOString(), values: values };
  });
  return kxbJson_({ ok: true, form: form.getTitle(), columns: columns, rows: rows, at: new Date().toISOString() });
}

function kxbJson_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
