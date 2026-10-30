/**
 * 端末間コピペ（copipe） スプレッドシート側のプログラム
 * 使い方は SETUP.md を参照。
 * 1) このコードを貼り付けて保存 → 関数「setup」を1回実行（合言葉は自動で作られます）
 * 2) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *    実行ユーザー：自分 ／ アクセスできるユーザー：全員
 * 3) スプシを開き直し、メニュー「コピペ」→「この端末を設定」
 */

var APP_URL = 'https://cotoxdgn.github.io/copipe/';
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
  conf_();
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 2 && def.getLastRow() === 0) ss.deleteSheet(def);
}

// 「設定」シートを整え、合言葉が空なら自動で作る
function conf_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = ss.getSheetByName(CONF_SHEET) || ss.insertSheet(CONF_SHEET);
  conf.getRange('A1').setValue('合言葉（自動）').setFontWeight('bold');
  conf.getRange('A2').setValue('接続URL（自動）').setFontWeight('bold');
  conf.getRange('B1:B2').setNumberFormat('@');
  conf.getRange('A3').clearContent();
  conf.getRange('A4').setValue('入力は不要です。端末の設定は、メニュー「コピペ」→「この端末を設定」から行います。B1・B2は人に見せないでください。');
  var key = String(conf.getRange('B1').getValue()).trim();
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    conf.getRange('B1').setValue(key);
  }
  return conf;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('コピペ')
    .addItem('この端末を設定（リンクとQR）', 'showSetup')
    .addToUi();
}

// 公開URL（…/exec）を探す：自動で取れなければ B2 の値を使う
function execUrl_(conf) {
  var u = '';
  try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  if (/\/exec$/.test(u)) {
    conf.getRange('B2').setValue(u);
    return u;
  }
  var saved = String(conf.getRange('B2').getValue()).trim();
  return /\/exec$/.test(saved) ? saved : '';
}

function showSetup() {
  var conf = conf_();
  var url = execUrl_(conf);
  var key = String(conf.getRange('B1').getValue()).trim();
  var t = HtmlService.createTemplate(SETUP_HTML);
  t.url = url;
  t.link = url ? APP_URL + '#setup=' + b64url_(JSON.stringify({ u: url, k: key })) : '';
  t.qrLib = APP_URL + 'lib/qrcode.js';
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(420).setHeight(560), '端末間コピペ：この端末を設定');
}

function b64url_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

var SETUP_HTML = [
  '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1F2328">',
  '<? if (!url) { ?>',
  '<p style="color:#9B2C1C;font-weight:bold">公開URLが見つかりませんでした。</p>',
  '<p>「デプロイ」→「デプロイを管理」で、ウェブアプリのURL（…/exec で終わるもの）をコピーし、「設定」シートの <b>B2</b> に貼り付けてから、もう一度このメニューを開いてください。</p>',
  '<? } else { ?>',
  '<p><b>このパソコン</b>：下のボタンを押すと、アプリが開いて設定が終わります。</p>',
  '<p><a href="<?= link ?>" target="_blank" rel="noopener" style="display:block;text-align:center;background:#0F6E6E;color:#fff;padding:12px;border-radius:12px;text-decoration:none;font-weight:bold">アプリを開いて設定する</a></p>',
  '<p><b>iPhone・iPad</b>：ホーム画面のアプリで「QRを読み取って設定」を押し、このQRを映してください。</p>',
  '<div id="qr" style="text-align:center"></div>',
  '<p style="color:#9B2C1C;font-size:12px">このリンクとQRには合言葉が入っています。スクショ・共有はしないでください。</p>',
  '<script src="<?= qrLib ?>"></script>',
  '<script>',
  '  try { var q = qrcode(0, "M"); q.addData(<?!= JSON.stringify(link) ?>); q.make();',
  '    document.getElementById("qr").innerHTML = q.createImgTag(5, 8); } catch (e) {',
  '    document.getElementById("qr").textContent = "QRを表示できませんでした（ボタンからの設定は使えます）"; }',
  '</script>',
  '<? } ?>',
  '</div>'
].join('\n');

function doGet() {
  // ブラウザで …/exec を開いたときに、公開URLを覚えておく（メニューの設定用）
  try { conf_() && execUrl_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONF_SHEET)); } catch (e) { /* 無視 */ }
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
  if (!pass) return out_({ ok: false, error: 'no_pass' });  // setup 未実行
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
