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
    bad_key: '接続の鍵が合いません。スプシのメニュー「コピペ」から設定し直してください',
    no_pass: 'スプシの準備が終わっていません（関数「setup」を実行してください）',
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

  // 鍵が合わなくなったときは、設定し直しを案内する
  function fail(e) {
    if (e && e.message === 'bad_key' && state.cfg && !$('main').hidden) {
      showSetup(false);
      setStatus('スプシにつながらなくなりました。スプシのメニュー「コピペ」→「この端末を設定」のボタンからもう一度設定してください', true);
      return;
    }
    toast(errText(e), true);
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
      if (!quiet || e.message === 'bad_key') fail(e);
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
      fail(e);
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
    }).catch(function (e) { fail(e); });
  }

  function deleteItem(it) {
    var preview = it.text.length > 30 ? it.text.slice(0, 30) + '…' : it.text;
    if (!window.confirm('この履歴を削除しますか？\n\n' + preview)) return;
    api('delete', { id: it.id }).then(function (d) {
      applyItems(d.items);
      toast('削除しました');
    }).catch(function (e) { fail(e); });
  }

  // ---------- 設定 ----------
  function showSetup(isFirst, preset) {
    $('main').hidden = true;
    $('setup').hidden = false;
    $('setupTitle').textContent = isFirst ? 'はじめての設定' : '設定';
    $('cancelSetupBtn').hidden = isFirst;
    var c = preset || state.cfg || {};
    $('cfgUrl').value = c.url || '';
    $('cfgKey').value = c.key || '';
    $('cfgLink').value = '';
    $('cfgDevice').value = (state.cfg && state.cfg.device) || detectDevice();
    $('setupStatus').hidden = true;
    // カメラが使えない環境では最初から手入力を開く
    var canScan = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    // 設定済みの端末は「他の端末を追加」が主役。読み取りは未設定のときだけ
    var mobile = isIOS() || /Android/.test(navigator.userAgent);
    $('qrStart').hidden = !canScan || !mobile || !!state.cfg;
    $('manualBox').open = false;
    $('manualSummary').textContent = state.cfg ? '接続先を変更する（設定リンクを貼り付け）' : '設定リンクを貼り付けて設定';
    $('saveCfgBtn').textContent = state.cfg ? '保存' : '保存してはじめる';
    $('setupLead').textContent = state.cfg
      ? 'iPhone・iPadを追加するときは、下の「QRを表示」を押してください。'
      : (isIOS()
        ? 'スプシのメニュー「コピペ」→「この端末を設定」か、設定済みの端末の 歯車 →「他の端末を追加」に出るQRを読み取ってください。'
        : 'スプシのメニュー「コピペ」→「この端末を設定」を開き、「アプリを開いて設定する」を押すと設定が終わります。');
    // 設定済みの端末だけ「他の端末を追加」を出す
    $('shareBox').hidden = !state.cfg;
    hideQr();
  }

  // ---------- QR（他の端末を追加） ----------
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  function setupLink(c) {
    var base = location.href.split('#')[0].split('?')[0];
    return base + '#setup=' + b64urlEncode(JSON.stringify({ u: c.url, k: c.key }));
  }
  // QRの中身（このアプリのURL＋#setup=…）から設定を取り出す
  function parseSetup(text) {
    var m = /#setup=([A-Za-z0-9_-]+)/.exec(text || '');
    if (!m) return null;
    try {
      var o = JSON.parse(b64urlDecode(m[1]));
      if (o && typeof o.u === 'string' && typeof o.k === 'string') return { url: o.u, key: o.k };
    } catch (e) { /* 読めないQR */ }
    return null;
  }
  function showQr() {
    if (!state.cfg) return;
    var draw = function () {
      var qr = qrcode(0, 'M');
      qr.addData(setupLink(state.cfg));
      qr.make();
      $('qrImg').src = qr.createDataURL(8, 16);
      $('qrWrap').hidden = false;
      $('showQrBtn').hidden = true;
    };
    if (window.qrcode) { draw(); return; }
    loadScript('lib/qrcode.js').then(draw, function () { toast('QRを表示できませんでした（通信を確認）', true); });
  }
  function hideQr() {
    $('qrWrap').hidden = true;
    $('qrImg').removeAttribute('src');
    $('showQrBtn').hidden = false;
  }

  // ---------- QR読み取り ----------
  var scan = { stream: null, raf: 0, canvas: null };
  function startScan() {
    var go = function () {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }).then(function (stream) {
        scan.stream = stream;
        var v = $('scanVideo');
        v.srcObject = stream;
        $('scanMsg').textContent = 'QRを枠の中に映してください';
        $('scanner').hidden = false;
        return v.play().catch(function () {}).then(function () { scanLoop(); });
      });
    };
    var ready = window.jsQR ? Promise.resolve() : loadScript('lib/jsQR.js');
    ready.then(go).catch(function (e) {
      stopScan();
      if (e && e.message === 'load') { toast('読み取りの準備ができませんでした（通信を確認）', true); return; }
      $('manualBox').open = true;
      setStatus('カメラを使えませんでした。設定アプリでカメラを許可するか、「手で入力する」から入れてください', true);
    });
  }
  function scanLoop() {
    var v = $('scanVideo');
    if (!scan.stream) return;
    if (v.readyState >= 2 && v.videoWidth) {
      var w = v.videoWidth, h = v.videoHeight;
      var scale = Math.min(1, 800 / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var cv = scan.canvas || (scan.canvas = document.createElement('canvas'));
      cv.width = cw; cv.height = ch;
      var ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, cw, ch);
      var img = ctx.getImageData(0, 0, cw, ch);
      var hit = window.jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
      if (hit && hit.data) {
        var c = parseSetup(hit.data);
        if (c) { stopScan(); onScanned(c); return; }
        $('scanMsg').textContent = 'このアプリの設定用QRではありません';
      }
    }
    scan.raf = requestAnimationFrame(scanLoop);
  }
  function stopScan() {
    cancelAnimationFrame(scan.raf);
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan.stream = null;
    $('scanVideo').srcObject = null;
    $('scanner').hidden = true;
  }
  function onScanned(c) {
    $('cfgUrl').value = c.url;
    $('cfgKey').value = c.key;
    finishSetup();
  }
  function showMain() {
    $('setup').hidden = true;
    $('main').hidden = false;
    $('deviceChip').textContent = state.cfg.device;
  }
  function readForm() {
    var c = {
      url: $('cfgUrl').value.trim(),
      key: $('cfgKey').value.trim(),
      device: $('cfgDevice').value.trim() || detectDevice()
    };
    var raw = $('cfgLink').value.trim();
    if (raw) {
      var fromLink = parseSetup(raw);
      if (fromLink) { c.url = fromLink.url; c.key = fromLink.key; } else { c.badLink = true; }
    }
    return c;
  }
  function setStatus(msg, isError) {
    var s = $('setupStatus');
    s.textContent = msg;
    s.classList.toggle('error', !!isError);
    s.hidden = false;
  }
  function validCfg(c) {
    if (c.badLink) {
      $('manualBox').open = true;
      setStatus('設定リンクではないようです。スプシのメニュー「コピペ」→「この端末を設定」のリンクを貼り付けてください', true);
      return false;
    }
    if (!c.url || !c.key) {
      setStatus(isIOS()
        ? '「QRを読み取って設定」を押して、スプシのメニューか設定済みの端末に出るQRを映してください'
        : 'スプシのメニュー「コピペ」→「この端末を設定」を開き、「アプリを開いて設定する」を押してください', true);
      return false;
    }
    if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(c.url) && !/^http:\/\/localhost(:\d+)?\//.test(c.url)) {
      $('manualBox').open = true;
      setStatus('設定リンクの中身が正しくありません。スプシのメニューからもう一度リンクを開いてください', true);
      return false;
    }
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

  function finishSetup() {
    var c = readForm();
    if (!validCfg(c)) return;
    testCfg(c).then(function (d) {
      if (!d) { $('manualBox').open = true; return; }
      state.cfg = c;
      store(CFG_KEY, c);
      showMain();
      applyItems(d.items);
      toast('設定しました');
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
      finishSetup();
    });
    $('scanBtn').addEventListener('click', startScan);
    $('scanCancel').addEventListener('click', stopScan);
    $('showQrBtn').addEventListener('click', showQr);
    $('hideQrBtn').addEventListener('click', hideQr);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && state.cfg && !$('main').hidden && Date.now() - state.lastFetch > 3000) refresh(true);
    });
    window.addEventListener('online', function () { if (state.cfg) refresh(true); });

    state.cfg = load(CFG_KEY);
    if (state.cfg && (!state.cfg.url || !state.cfg.key)) state.cfg = null;
    // スマホの標準カメラでQRを読んでこのページが開いた場合
    var fromLink = parseSetup(location.hash);
    if (fromLink) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 無視 */ }
      showSetup(!state.cfg, fromLink);
      if (!state.cfg) {
        finishSetup();  // 未設定ならそのまま設定を終える
      } else {
        setStatus('新しい接続先を読み込みました。切り替えるなら「保存」を押してください', false);
      }
    } else if (!state.cfg) {
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
