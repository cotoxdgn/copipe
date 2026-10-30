# 端末間コピペ

iPhone・iPad・Windowsの間でテキストやURLを受け渡すWebアプリ（PWA）。
データは各自のGoogleスプレッドシートに保存し、Google Apps Scriptで端末間を同期します。

- アプリ：https://cotoxdgn.github.io/copipe/
- 設定手順：[SETUP.md](SETUP.md)
- スプレッドシート側のプログラム：[gas/Code.gs](gas/Code.gs)

## 同梱ライブラリ

- `lib/qrcode.js` … QRコード作成（qrcode-generator / Kazuhiko Arase / MIT License）
- `lib/jsQR.js` … QRコード読み取り（jsQR / Cosmo Wolfe / Apache License 2.0、`lib/jsQR-LICENSE.txt`）
