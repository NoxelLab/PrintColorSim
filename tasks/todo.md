# 実装タスク

- [x] 土台：git、Vite + Svelte + TypeScript、lcms-wasm と mupdf、プロファイルの取得
- [x] 色変換の核：cms、lab、proof（RGB 画像の分版・再現・ΔE）
- [x] PDF の検証：OutputIntent の差し替えで DeviceCMYK の値が保たれるか
- [x] 入力の拡張：CMYK の JPEG / TIFF、PSD、複数ページ、埋め込みプロファイル、ICC の読み込みと保存
- [x] UI：情報パネル型の画面と各機能の接続
- [x] 書き出しと導線：保存2種、X で共有、ソースコード
- [x] 資料：docs の更新、docs/ui の削除、README、LICENSE
- [x] ルーターへの組み込み：sync-apps.mjs、_headers、_redirects
- [x] 公開：GitHub の NoxelLab/PrintColorSim、noxelwork-router のデプロイ
- [x] 検索と共有：言語別ページ、canonical と hreflang、JSON-LD、OG 画像、robots.txt とサイトマップ、IndexNow

# 立体表示

- [x] three.js の導入と、純粋な関数（lighting、surface、rotation）とその単体テスト
- [x] Worker の render にインキの面積率と紙の色を加える
- [x] viewer.ts と Scene.svelte、比較との切り替え、照明の選択、保存
- [x] 照明ごとの露出と白の色合いを撮影で合わせる
- [x] 資料（core.txt、docs、README、説明文と JSON-LD）
- [x] コミット、プッシュ、デプロイ、IndexNow

# 残っている作業

- [ ] Cloudflare Web Analytics のサイトトークンを取得し、ビーコンのスニペットを index.html と en.html に追加する
- [ ] Google Search Console に noxelwork.com を登録し、サイトマップを送信する（利用者の Google アカウントが必要）
- [ ] スマホの実機（Safari、X のアプリ内ブラウザ）で読み込み・操作・保存を確認する
- [ ] スマホの実機で立体表示の描画・回転・拡大・保存と、P3 表示での色を確認する
