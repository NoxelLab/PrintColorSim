# Print Color Simulator

入稿データが実際に印刷されたときの色味を画面上で再現し、入稿前に確認するための Web アプリ

印刷方式と用紙を選ぶと、ICC プロファイルで変換した印刷再現を元データと並べて表示します。\
処理はすべてブラウザの中で行い、画像は外部へ送りません。

公開先：<https://noxelwork.com/prtcorsim>（英語版：<https://noxelwork.com/prtcorsim/en>）

## できること

- PNG、JPEG、PDF、PSD、TIFF の読み込み（CMYK のデータは値を保ったまま扱います）
- 元データと印刷再現をスライダーで見比べる表示
- 印刷で色が変わる範囲の強調表示と割合の算出
- 指定した点の RGB 値と CMYK 値の読み取り
- 印刷会社の ICC プロファイルの読み込み
- 日光・曇り空・昼白色・電球色の照明の下での見え方とつやを確かめる立体表示
- 再現画像・比較画像・立体の表示の保存

仕様は [core.txt](core.txt) と [docs](docs) にあります。

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm run check    # 型チェック
npm test         # テスト
npm run build    # dist へビルド
```

ビルドした成果物は `/prtcorsim/` のパスで配信する前提になっています。

## ライセンス

AGPL-3.0-or-later（[LICENSE](LICENSE)）

PDF と画像の読み込みに [MuPDF](https://mupdf.com/)（AGPL）、色変換に [Little CMS](https://www.littlecms.com/)（MIT）、立体表示に [three.js](https://threejs.org/)（MIT）を使っています。

`public/profiles` の ICC プロファイルは AGPL の対象外で、それぞれの権利者の条件に従います。（[NOTICE.txt](public/profiles/NOTICE.txt)）
