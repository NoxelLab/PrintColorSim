import type { Method, Paper, Pp, Use } from './conditions';

/** 材質の値。粗さは three.js の roughness で、光沢計の値から換算した */
export interface Finish {
  /** 紙の粗さ */
  paper: number;
  /** インキに覆われた所の粗さ */
  ink: number;
  /** PP 加工の透明な層 */
  clearcoat: number;
  clearcoatRoughness: number;
  specularIntensity: number;
}

const PAPER: Record<Paper, [paper: number, ink: number]> = {
  coat: [0.22, 0.2],
  matte: [0.4, 0.33],
  plain: [0.55, 0.55],
  special: [0.6, 0.6],
};
/** 乾式トナーは紙より光る */
const TONER = 0.32;
const FILM: Record<Pp, number> = { none: 0, gloss: 0.1, mattepp: 0.4 };

export function finish(paper: Paper, method: Method, pp: Pp): Finish {
  const [base, ink] = PAPER[paper];
  return {
    paper: base,
    ink: method === 'inkjet' ? base : method === 'ondemand' ? Math.min(ink, TONER) : ink,
    clearcoat: pp === 'none' ? 0 : 1,
    clearcoatRoughness: FILM[pp],
    specularIntensity: paper === 'plain' || paper === 'special' ? 0.6 : 1,
  };
}

/** 画素ごとにインキに覆われた面積率（0〜255）。4 色がそれぞれ独立に載るとみなす */
export function coverage(cmyk: Uint8Array) {
  const out = new Uint8Array(cmyk.length / 4);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = Math.round(255 - ((255 - cmyk[j]) * (255 - cmyk[j + 1]) * (255 - cmyk[j + 2]) * (255 - cmyk[j + 3])) / 255 ** 3);
  }
  return out;
}

/** 紙の表面の画像。R は色域外のマスク、G は粗さ */
export function surfaceMap(ink: Uint8Array, mask: Uint8ClampedArray, f: Finish) {
  const out = new Uint8Array(ink.length * 4);
  const base = f.paper * 255, span = f.ink - f.paper;
  for (let i = 0, o = 0; i < ink.length; i++, o += 4) {
    out[o] = mask[o + 3];
    out[o + 1] = Math.round(base + span * ink[i]);
    out[o + 3] = 255;
  }
  return out;
}

/** 長辺に対する紙の厚さ。用途ごとの代表的な大きさ（名刺、B2、A4、A5）と紙の厚さから */
export const THICKNESS: Record<Use, number> = { card: 0.3 / 91, poster: 0.15 / 728, flyer: 0.09 / 297, book: 0.1 / 210 };
