import type * as Mupdf from 'mupdf';
import { extract, iccSpace } from './icc-extract';
import type { Raster } from './proof';

/** 作業用画像の長辺の上限 */
export const MAX_WORK = 4096;
/** 読み込みを受け付ける画像の画素数の上限 */
const MAX_PIXELS = 100e6;
/** PDF を描画する解像度の上限（dpi） */
const MAX_PDF_DPI = 300;

export type FileErrorCode = 'unsupported' | 'tooLarge' | 'password' | 'badProfile';
export class FileError extends Error {
  constructor(public code: FileErrorCode) {
    super(code);
  }
}

export interface PrintProfile { key: string; icc: Uint8Array }

export interface Source {
  pages: number;
  space: 'rgb' | 'cmyk' | 'pdf';
  /** RGB / CMYK 画像の埋め込みプロファイル、または PDF の OutputIntent */
  embedded: Uint8Array | null;
  /** key は画素の内容を識別する。sep は分版が元データと別に得られる場合だけ返す。 */
  rasters(page: number, maxLong: number, print: PrintProfile): { key: string; orig: Raster; sep: Uint8Array | null };
}

let mupdf: typeof Mupdf;
export async function loadMupdf() {
  mupdf ??= await import('mupdf');
}

/** 面積平均で縮小しながら、アルファを白地に合成し RGB か CMYK の画素へ詰め直す */
export function resample(src: ArrayLike<number>, sw: number, sh: number, stride: number, n: number, alpha: boolean, maxLong: number): Raster {
  const colors = n - (alpha ? 1 : 0);
  if (colors !== 1 && colors !== 3 && colors !== 4) throw new FileError('unsupported');
  const ch = colors === 4 ? 4 : 3;
  const scale = Math.min(1, maxLong / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const data = new Uint8Array(w * h * ch);
  for (let y = 0, o = 0; y < h; y++) {
    const y0 = Math.floor((y * sh) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
    for (let x = 0; x < w; x++, o += ch) {
      const x0 = Math.floor((x * sw) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0, i = yy * stride + x0 * n; xx < x1; xx++, i += n) {
          const pad = alpha && colors !== 4 ? 255 - src[i + colors] : 0;
          s0 += src[i] + pad;
          if (colors > 1) { s1 += src[i + 1] + pad; s2 += src[i + 2] + pad; }
          if (colors === 4) s3 += src[i + 3];
        }
      }
      const count = (x1 - x0) * (y1 - y0);
      data[o] = s0 / count;
      data[o + 1] = (colors === 1 ? s0 : s1) / count;
      data[o + 2] = (colors === 1 ? s0 : s2) / count;
      if (ch === 4) data[o + 3] = s3 / count;
    }
  }
  return { w, h, ch, data };
}

/** EXIF の向き 3・6・8 に合わせて回転する */
function orient(r: Raster, orientation: number): Raster {
  if (orientation !== 3 && orientation !== 6 && orientation !== 8) return r;
  const { w, h, ch } = r, turn = orientation !== 3;
  const out: Raster = { w: turn ? h : w, h: turn ? w : h, ch, data: new Uint8Array(r.data.length) };
  for (let y = 0, o = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++, o += ch) {
      const sx = orientation === 3 ? w - 1 - x : orientation === 6 ? y : w - 1 - y;
      const sy = orientation === 3 ? h - 1 - y : orientation === 6 ? h - 1 - x : x;
      const i = (sy * w + sx) * ch;
      for (let c = 0; c < ch; c++) out.data[o + c] = r.data[i + c];
    }
  }
  return out;
}

class ImageSource implements Source {
  pages = 1;
  space: 'rgb' | 'cmyk';
  embedded: Uint8Array | null;
  #work: Raster;
  #preview?: { key: string; raster: Raster };

  constructor(bytes: Uint8Array, icc: Uint8Array | null, orientation: number) {
    let image: Mupdf.Image;
    try {
      image = new mupdf.Image(bytes);
    } catch {
      throw new FileError('unsupported');
    }
    if (image.getWidth() * image.getHeight() > MAX_PIXELS) throw new FileError('tooLarge');
    const pixmap = image.toPixmap(), alpha = pixmap.getAlpha() > 0, n = pixmap.getNumberOfComponents();
    this.#work = orient(resample(pixmap.getPixels(), pixmap.getWidth(), pixmap.getHeight(), pixmap.getStride(), n, alpha, MAX_WORK), orientation);
    pixmap.destroy();
    image.destroy();
    this.space = this.#work.ch === 4 ? 'cmyk' : 'rgb';
    const gray = n - (alpha ? 1 : 0) === 1;
    this.embedded = icc && !gray && iccSpace(icc) === (this.space === 'cmyk' ? 'CMYK' : 'RGB') ? icc : null;
  }

  rasters(_page: number, maxLong: number) {
    const work = this.#work, key = `0|${maxLong}`;
    let orig = work;
    if (maxLong < Math.max(work.w, work.h)) {
      if (this.#preview?.key !== key) this.#preview = { key, raster: resample(work.data, work.w, work.h, work.w * work.ch, work.ch, false, maxLong) };
      orig = this.#preview.raster;
    }
    return { key, orig, sep: orig.ch === 4 ? orig.data : null };
  }
}

class PdfSource implements Source {
  pages: number;
  space = 'pdf' as const;
  embedded: Uint8Array | null = null;
  #bytes: Uint8Array;
  #wide: Mupdf.ColorSpace;
  #rendered?: { key: string; orig: Raster; sep: Uint8Array };
  #print?: { key: string; doc: Mupdf.PDFDocument; space: Mupdf.ColorSpace };

  /** wide は元データの描画に使う広色域 RGB のプロファイル */
  constructor(bytes: Uint8Array, wide: Uint8Array) {
    this.#bytes = bytes;
    let doc: Mupdf.Document;
    try {
      doc = mupdf.Document.openDocument(bytes, 'application/pdf');
    } catch {
      throw new FileError('unsupported');
    }
    if (doc.needsPassword()) throw new FileError('password');
    this.pages = doc.countPages();
    this.#wide = new mupdf.ColorSpace(wide, 'wide');
    try {
      const intents = doc.asPDF()!.getTrailer().get('Root', 'OutputIntents');
      const profile = intents.isArray() && intents.length ? intents.get(0, 'DestOutputProfile') : null;
      const icc = profile?.isStream() ? profile.readStream().asUint8Array().slice() : null;
      if (icc && iccSpace(icc) === 'CMYK') this.embedded = icc;
    } catch {
      // OutputIntent を読めない PDF は指定なしとして扱う
    }
    doc.destroy();
  }

  /**
   * OutputIntent を印刷プロファイルへ差し替えた文書を開く。
   * 印刷プロファイルの色空間へ描画すると DeviceCMYK の値がそのまま残り、RGB の要素だけが変換される。
   */
  #withIntent(print: PrintProfile) {
    if (this.#print?.key === print.key) return this.#print;
    this.#print?.doc.destroy();
    this.#print?.space.destroy();
    const doc = mupdf.Document.openDocument(this.#bytes, 'application/pdf').asPDF()!;
    const intent = doc.addObject(doc.newDictionary());
    intent.put('Type', doc.newName('OutputIntent'));
    intent.put('S', doc.newName('GTS_PDFX'));
    intent.put('OutputConditionIdentifier', doc.newString('Custom'));
    intent.put('DestOutputProfile', doc.addStream(print.icc, { N: 4 }));
    const intents = doc.newArray();
    intents.push(intent);
    doc.getTrailer().get('Root').put('OutputIntents', intents);
    return (this.#print = { key: print.key, doc, space: new mupdf.ColorSpace(print.icc, 'print') });
  }

  #render(doc: Mupdf.Document, pageNumber: number, maxLong: number, space: Mupdf.ColorSpace) {
    const page = doc.loadPage(pageNumber);
    const [x0, y0, x1, y1] = page.getBounds();
    const scale = Math.min(maxLong / Math.max(x1 - x0, y1 - y0), MAX_PDF_DPI / 72);
    const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), space, false);
    const raster = resample(pixmap.getPixels(), pixmap.getWidth(), pixmap.getHeight(), pixmap.getStride(), pixmap.getNumberOfComponents(), false, Infinity);
    pixmap.destroy();
    page.destroy();
    return raster;
  }

  /** 元データは CMYK の色を切り詰めないよう広色域 RGB へ描画する */
  rasters(page: number, maxLong: number, print: PrintProfile) {
    const key = `${page}|${maxLong}|${print.key}`;
    if (this.#rendered?.key !== key) {
      const { doc, space } = this.#withIntent(print);
      this.#rendered = { key, orig: this.#render(doc, page, maxLong, this.#wide), sep: this.#render(doc, page, maxLong, space).data };
    }
    return this.#rendered;
  }
}

const isPdf = (b: Uint8Array) => {
  for (let i = 0; i < 1024 && i + 5 <= b.length; i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46 && b[i + 4] === 0x2d) return true;
  }
  return false;
};

export async function open(bytes: Uint8Array, wide: Uint8Array): Promise<Source> {
  await loadMupdf();
  if (isPdf(bytes)) return new PdfSource(bytes, wide);
  const { icc, orientation } = await extract(bytes);
  return new ImageSource(bytes, icc, orientation);
}
