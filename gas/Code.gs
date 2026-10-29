/**
 * 端末間コピペ（copipe） スプレッドシート側のプログラム
 * 使い方は SETUP.md を参照。
 * 1) このコードを貼り付けて保存 → 関数「setup」を1回実行
 * 2) 「設定」シートの B1 に合言葉を入れる
 * 3) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    実行ユーザー：自分 ／ アクセスできるユーザー：全員
 */

var ITEMS_SHEET = 'items';
var CONF_SHEET = '設定';
var MAX_ITEMS = 20;      // ピン留め以外で残す件数
var MAX_LEN = 50000;     // 1件の上限（スプシのセル上限）
var HEADER = ['id', 'text', 'type', 'device', 'createdAt', 'pinned'];

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ITEMS_SHEET) || ss.insertSheet(ITEMS_SHEET);
  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
  sh.getRange('A:F').setNumberFormat('@');
  sh.setFrozenRows(1);
  var conf = ss.getSheetByName(CONF_SHEET) || ss.insertSheet(CONF_SHEET);
  conf.getRange('A1').setValue('合言葉').setFontWeight('bold');
  conf.getRange('B1').setNumberFormat('@');
  conf.getRange('A3').setValue('B1に合言葉を入れてください。アプリの初回設定で同じものを入力します。');
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 2 && def.getLastRow() === 0) ss.deleteSheet(def);
}

function doGet() {
  return out_({ ok: true, app: 'copipe' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'bad_request' });
  }
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = ss.getSheetByName(CONF_SHEET);
  var pass = conf ? String(conf.getRange('B1').getValue()).trim() : '';
  if (!pass) return out_({ ok: false, error: 'no_pass' });
  if (String(req.key || '') !== pass) return out_({ ok: false, error: 'bad_key' });

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ss.getSheetByName(ITEMS_SHEET);
    if (!sh) return out_({ ok: false, error: 'no_sheet' });
    switch (req.action) {
      case 'list': break;
      case 'add':
        var err = add_(sh, req);
        if (err) return out_({ ok: false, error: err });
        break;
      case 'delete': remove_(sh, String(req.id)); break;
      case 'pin': pin_(sh, String(req.id), !!req.pinned); break;
      default: return out_({ ok: false, error: 'bad_action' });
    }
    return out_({ ok: true, items: readAll_(sh) });
  } finally {
    lock.releaseLock();
  }
}

function add_(sh, req) {
  var text = String(req.text || '');
  if (!text.trim()) return 'empty';
  if (text.length > MAX_LEN) return 'too_long';
  var type = /^https?:\/\/\S+$/.test(text.trim()) ? 'url' : 'text';
  var row = [Utilities.getUuid(), text, type, String(req.device || '').slice(0, 30), new Date().toISOString(), 'FALSE'];
  var r = sh.getLastRow() + 1;
  var range = sh.getRange(r, 1, 1, HEADER.length);
  range.setNumberFormat('@');
  range.setValues([row]);
  trim_(sh);
  return null;
}

function trim_(sh) {
  var rows = rows_(sh);
  var unpinned = rows.filter(function (x) { return !x.pinned; });
  if (unpinned.length <= MAX_ITEMS) return;
  unpinned.sort(newer_);
  var drop = unpinned.slice(MAX_ITEMS).map(function (x) { return x.row; });
  drop.sort(function (a, b) { return b - a; });
  drop.forEach(function (r) { sh.deleteRow(r); });
}

function remove_(sh, id) {
  var rows = rows_(sh);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (rows[i].id === id) sh.deleteRow(rows[i].row);
  }
}

function pin_(sh, id, pinned) {
  rows_(sh).forEach(function (x) {
    if (x.id === id) sh.getRange(x.row, 6).setValue(pinned ? 'TRUE' : 'FALSE');
  });
}

function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  return vals.map(function (v, i) {
    return {
      row: i + 2,
      id: String(v[0]),
      text: String(v[1]),
      type: String(v[2]),
      device: String(v[3]),
      createdAt: String(v[4]),
      pinned: String(v[5]).toUpperCase() === 'TRUE'
    };
  }).filter(function (x) { return x.id; });
}

// 新しい順（同時刻なら下の行ほど新しい）
function newer_(a, b) {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return b.row - a.row;
}

function readAll_(sh) {
  return rows_(sh)
    .sort(newer_)
    .map(function (x) {
      return { id: x.id, text: x.text, type: x.type, device: x.device, createdAt: x.createdAt, pinned: x.pinned };
    });
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
