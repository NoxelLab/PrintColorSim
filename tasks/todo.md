# 実装タスク

- [x] 土台：git、Vite + Svelte + TypeScript、lcms-wasm と mupdf、プロファイルの取得
- [x] 色変換の核：cms、lab、proof（RGB 画像の分版・再現・ΔE）
- [x] PDF の検証：OutputIntent の差し替えで DeviceCMYK の値が保たれるか
- [x] 入力の拡張：CMYK の JPEG / TIFF、PSD、複数ページ、埋め込みプロファイル、ICC の読み込みと保存
- [x] UI：情報パネル型の画面と各機能の接続
- [x] 書き出しと導線：保存2種、X で共有、ソースコード
- [x] 資料：docs の更新、docs/ui の削除、README、LICENSE
- [x] ルーターへの組み込み：sync-apps.mjs、_headers、_redirects

# 公開までに必要な作業

- [ ] Cloudflare Web Analytics のサイトトークンを取得し、ビーコンのスニペットを index.html に追加する
- [ ] スマホの実機（Safari、X のアプリ内ブラウザ）で読み込み・操作・保存を確認する
- [x] 最初のコミットを作成し、GitHub に NoxelLab/PrintColorSim を公開する
- [x] noxelwork-router をデプロイする
