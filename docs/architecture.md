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
| 公開 URL | https://noxelwork.com/prtcorsim |
| 配信方式 | noxelwork-router の静的アセットに同梱 |

ビルドは `base` を `/prtcorsim/` として行います。\
noxelwork-router の `sync-apps.mjs` がビルドを実行し、成果物を `public/prtcorsim` に、`index.html` を `public/prtcorsim.html` に配置します。

静的アセットはスクリプトを実行せずに配信されます。

## 外部との通信

アクセス解析として Cloudflare Web Analytics を導入します。\
利用者の画像と設定は外部へ送信しません。
