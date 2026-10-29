/* 端末間コピペ（copipe） */
(function () {
  'use strict';

  var CFG_KEY = 'copipe.cfg';
  var CACHE_KEY = 'copipe.items';
  var MAX_LEN = 50000;
  var MAX_ITEMS = 20;

  var $ = function (id) { return document.getElementById(id); };
  var state = { cfg: null, items: [], busy: false, lastFetch: 0 };

  var ERRORS = {
    bad_key: '合言葉が違います',
    no_pass: 'スプシの「設定」シートB1に合言葉を入れてください',
    no_sheet: 'スプシの準備ができていません（setupを実行してください）',
    empty: '空の内容は保存できません',
    too_long: '長すぎます（5万字まで）',
    bad_action: 'アプリとスプシのバージョンが合っていません',
    bad_request: '送信内容が読み取れませんでした',
    network: '通信できませんでした。電波とURLを確認してください',
    offline: 'オフラインです。つながってから保存してください'
  };

  // ---------- 保存領域 ----------
  function store(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 保存できない環境では無視 */ }
  }
  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }

  // ---------- 端末判定 ----------
  function detectDevice() {
    var ua = navigator.userAgent;
    if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh/.test(ua)) return 'Mac';
    return 'この端末';
  }
  function isIOS() {
    var ua = navigator.userAgent;
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }

  // ---------- 通信 ----------
  function api(action, payload, cfg) {
    cfg = cfg || state.cfg;
    if (!navigator.onLine) return Promise.reject(new Error('offline'));
    var body = Object.assign({ action: action, key: cfg.key }, payload || {});
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      return res.text();
    }).then(function (txt) {
      var data;
      try { data = JSON.parse(txt); } catch (e) { throw new Error('network'); }
      if (!data.ok) throw new Error(data.error || 'network');
      return data;
    }, function (e) {
      throw new Error(e && e.message === 'offline' ? 'offline' : 'network');
    }).finally(function () { if (timer) clearTimeout(timer); });
  }
  function errText(e) {
    var code = e && e.message;
    return ERRORS[code] || ERRORS.network;
  }

  // ---------- 表示 ----------
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var now = new Date();
    var hm = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return hm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
  }
  function isUrl(text) { return /^https?:\/\/\S+$/.test(text.trim()); }

  var toastTimer;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.toggle('error', !!isError);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, isError ? 3500 : 1800);
  }

  function render() {
    var list = $('list');
    var tpl = $('itemTpl');
    list.textContent = '';
    var items = state.items;
    var unpinned = items.filter(function (x) { return !x.pinned; }).length;
    var pinned = items.length - unpinned;
    $('count').textContent = unpinned + ' / ' + MAX_ITEMS + '件' + (pinned ? '（ピン ' + pinned + '）' : '');
    $('empty').hidden = items.length > 0;
    var sorted = items.slice().sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    sorted.forEach(function (it) {
      var li = tpl.content.firstElementChild.cloneNode(true);
      li.dataset.id = it.id;
      if (it.pinned) li.classList.add('pinned');
      li.querySelector('.device').textContent = it.device || '';
      li.querySelector('.time').textContent = fmtTime(it.createdAt);
      li.querySelector('.text').textContent = it.text;
      var open = li.querySelector('.open');
      if (isUrl(it.text)) { open.href = it.text.trim(); } else { open.remove(); }
      var pinBtn = li.querySelector('.pin');
      pinBtn.setAttribute('aria-label', it.pinned ? 'ピン留めを外す' : 'ピン留め');
      pinBtn.setAttribute('aria-pressed', it.pinned ? 'true' : 'false');
      li.querySelector('.copy').addEventListener('click', function (ev) { copyItem(it, ev.currentTarget); });
      pinBtn.addEventListener('click', function () { togglePin(it); });
      li.querySelector('.del').addEventListener('click', function () { deleteItem(it); });
      list.appendChild(li);
    });
  }
  function setUpdated() {
    var d = new Date();
    var s = '更新 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    $('updated').textContent = s;
    $('updated2').textContent = s;
  }
  function applyItems(items) {
    state.items = items || [];
    store(CACHE_KEY, state.items);
    render();
    setUpdated();
  }

  // ---------- 操作 ----------
  function refresh(quiet) {
    if (!state.cfg) return Promise.resolve();
    var btn = $('refreshBtn');
    btn.classList.add('spinning');
    state.lastFetch = Date.now();
    return api('list').then(function (d) {
      applyItems(d.items);
    }).catch(function (e) {
      if (!quiet || e.message === 'bad_key') toast(errText(e), true);
    }).finally(function () { btn.classList.remove('spinning'); });
  }

  function saveText(text) {
    if (!text || !text.trim()) { toast('クリップボードが空です', true); return Promise.resolve(false); }
    if (text.length > MAX_LEN) { toast(ERRORS.too_long, true); return Promise.resolve(false); }
    state.busy = true;
    $('pasteBtn').disabled = true;
    return api('add', { text: text, device: state.cfg.device }).then(function (d) {
      applyItems(d.items);
      toast('保存しました');
      return true;
    }).catch(function (e) {
      toast(errText(e), true);
      return false;
    }).finally(function () {
      state.busy = false;
      $('pasteBtn').disabled = false;
    });
  }

  function pasteAndSave() {
    if (state.busy) return;
    // 入力欄に文字があるときは、その内容を保存する（クリップボードは読まない）
    var typed = $('manualInput').value;
    if (typed.trim()) { saveManual(); return; }
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      toast('この環境では読み取れません。手入力欄に貼り付けてください', true);
      $('manualInput').focus();
      return;
    }
    navigator.clipboard.readText().then(saveText, function () {
      toast(isIOS() ? '貼り付けが取り消されました' : 'クリップボードの許可が必要です', true);
    });
  }

  function saveManual() {
    if (state.busy) return;
    var mi = $('manualInput');
    var v = mi.value;
    if (!v.trim()) { toast('入力欄が空です', true); return; }
    saveText(v).then(function (ok) {
      if (ok) { mi.value = ''; mi.style.height = ''; updatePasteLabel(); }
    });
  }

  // 入力欄に文字があるときは大きいボタンを「入力した内容を保存」に切り替える
  function updatePasteLabel() {
    var typed = !!$('manualInput').value.trim();
    $('pasteLabel').textContent = typed ? '入力した内容を保存' : '貼り付けて保存';
    $('pasteBtn').classList.toggle('typed', typed);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy'));
    });
  }
  function copyItem(it, btn) {
    copyText(it.text).then(function () {
      btn.textContent = 'コピー済み';
      btn.classList.add('done');
      toast('コピーしました');
      setTimeout(function () { btn.textContent = 'コピー'; btn.classList.remove('done'); }, 1500);
    }, function () { toast('コピーできませんでした', true); });
  }

  function togglePin(it) {
    api('pin', { id: it.id, pinned: !it.pinned }).then(function (d) {
      applyItems(d.items);
    }).catch(function (e) { toast(errText(e), true); });
  }

  function deleteItem(it) {
    var preview = it.text.length > 30 ? it.text.slice(0, 30) + '…' : it.text;
    if (!window.confirm('この履歴を削除しますか？\n\n' + preview)) return;
    api('delete', { id: it.id }).then(function (d) {
      applyItems(d.items);
      toast('削除しました');
    }).catch(function (e) { toast(errText(e), true); });
  }

  // ---------- 設定 ----------
  function showSetup(isFirst) {
    $('main').hidden = true;
    $('setup').hidden = false;
    $('setupTitle').textContent = isFirst ? 'はじめての設定' : '設定';
    $('cancelSetupBtn').hidden = isFirst;
    var c = state.cfg || {};
    $('cfgUrl').value = c.url || '';
    $('cfgKey').value = c.key || '';
    $('cfgDevice').value = c.device || detectDevice();
    $('setupStatus').hidden = true;
  }
  function showMain() {
    $('setup').hidden = true;
    $('main').hidden = false;
    $('deviceChip').textContent = state.cfg.device;
  }
  function readForm() {
    return {
      url: $('cfgUrl').value.trim(),
      key: $('cfgKey').value.trim(),
      device: $('cfgDevice').value.trim() || detectDevice()
    };
  }
  function setStatus(msg, isError) {
    var s = $('setupStatus');
    s.textContent = msg;
    s.classList.toggle('error', !!isError);
    s.hidden = false;
  }
  function validCfg(c) {
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(c.url) && !/^http:\/\/localhost(:\d+)?\//.test(c.url)) {
      setStatus('URLは https://script.google.com/… で始まるものを入れてください', true);
      return false;
    }
    if (!c.key) { setStatus('合言葉を入れてください', true); return false; }
    return true;
  }
  function testCfg(c) {
    setStatus('接続を確認しています…', false);
    return api('list', null, c).then(function (d) {
      setStatus('接続できました（履歴 ' + d.items.length + '件）', false);
      return d;
    }, function (e) {
      setStatus(errText(e), true);
      return null;
    });
  }

  // ---------- 起動 ----------
  function init() {
    $('pasteHint').textContent = isIOS()
      ? '押したあと、表示される「ペースト」もタップしてください'
      : '初回だけブラウザがクリップボードの許可を聞きます。以降はワンクリック。';

    $('pasteBtn').addEventListener('click', pasteAndSave);
    $('refreshBtn').addEventListener('click', function () { refresh(false); });
    $('settingsBtn').addEventListener('click', function () { showSetup(false); });
    $('cancelSetupBtn').addEventListener('click', showMain);

    var mi = $('manualInput');
    mi.addEventListener('input', function () {
      if (window.matchMedia('(min-width: 900px)').matches) return;
      mi.style.height = 'auto';
      mi.style.height = Math.min(mi.scrollHeight, 160) + 'px';
    });
    mi.addEventListener('input', updatePasteLabel);
    $('manualForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      saveManual();
    });
    mi.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); $('manualForm').requestSubmit(); }
    });

    $('testBtn').addEventListener('click', function () {
      var c = readForm();
      if (validCfg(c)) testCfg(c);
    });
    $('setupForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var c = readForm();
      if (!validCfg(c)) return;
      testCfg(c).then(function (d) {
        if (!d) return;
        state.cfg = c;
        store(CFG_KEY, c);
        showMain();
        applyItems(d.items);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.cfg && !$('main').hidden && Date.now() - state.lastFetch > 3000) refresh(true);
    });
    window.addEventListener('online', function () { if (state.cfg) refresh(true); });

    state.cfg = load(CFG_KEY);
    if (!state.cfg || !state.cfg.url || !state.cfg.key) {
      showSetup(true);
    } else {
      showMain();
      state.items = load(CACHE_KEY) || [];
      render();
      refresh(true);
    }

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても動作は可能 */ });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
