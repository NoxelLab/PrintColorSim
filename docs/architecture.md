# 技術構成と公開

採用する技術と、ライセンス・配信の構成

## 技術

| 役割 | 採用 |
| --- | --- |
| 画面 | Svelte、TypeScript、Vite |
| 色変換 | Little CMS の WebAssembly 版（`lcms-wasm`） |
| PDF と画像の読み込み | MuPDF の WebAssembly 版（`mupdf`） |

サーバー側の処理は持たず、すべてブラウザ内で動作します。

## 構成

| 場所 | 内容 |
| --- | --- |
| `src/App.svelte`、`src/components` | 画面 |
| `src/lib` | 印刷条件、設定の保存、文言、Worker とのやり取り、画面出力、保存 |
| `src/worker` | ファイルの読み込みと色処理。Web Worker として動作する |
| `public/profiles` | 内蔵する ICC プロファイル |
| `tests` | Worker 側の処理のテスト |

画面と Worker は `src/lib/protocol.ts` に定めたメッセージでやり取りします。

## ライセンス

AGPL-3.0-or-later

MuPDF が AGPL で提供されているため、アプリ全体のソースコードを同じライセンスで GitHub に公開します。\
画面には公開リポジトリへのリンクを置きます。

ICC プロファイルは AGPL の対象外とし、それぞれの権利者の条件に従って無改変で同梱します。

## 配信

| 項目 | 内容 |
| --- | --- |
| 公開 URL | https://noxelwork.com/prtcorsim（日本語）、https://noxelwork.com/prtcorsim/en（英語） |
| 配信方式 | noxelwork-router の静的アセットに同梱 |

ビルドは `base` を `/prtcorsim/` とし、`index.html`（日本語）と `en.html`（英語）の 2 ページを出力します。\
noxelwork-router の `sync-apps.mjs` がビルドを実行し、成果物を `public/prtcorsim` に、`index.html` を `public/prtcorsim.html` に配置します。

静的アセットはスクリプトを実行せずに配信されます。

## 公開と検索

ツールの画面は JavaScript で描画するため、検索と共有に必要な情報は各ページの HTML に直接書きます。

| 要素 | 内容 |
| --- | --- |
| 言語 | 言語ごとに URL を分け、`canonical` と `hreflang`（`x-default` は英語）で対応を示す |
| 説明 | ツールの下に使い方・対応条件・よくある質問を静的な HTML で置く。JavaScript を実行しないクローラーにも読める |
| 構造化データ | `WebApplication` の JSON-LD。評価やレビューは実在しないため記載しない。画像は文字を重ねない `public/preview.jpg` |
| 共有 | `og:*` と `twitter:card`（`summary_large_image`）。画像は `public/og.jpg` と `public/og-en.jpg`（1200×630） |
| クロール | noxelwork-router の `public/robots.txt` と `public/sitemap.xml`（ドメイン直下）でサイトマップを知らせる。Bing などへは IndexNow で URL を通知する |

OG 画像の印刷側には、アプリが書き出したサンプルの再現画像を使います。

## 外部との通信

アクセス解析として Cloudflare Web Analytics を導入します。\
利用者の画像と設定は外部へ送信しません。
