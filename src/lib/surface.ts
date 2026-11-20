import type { Method, Paper, Pp, Use } from './conditions';

/** 材質の値。粗さは three.js の roughness で、光沢計の値（75° の光沢度）から換算した */
export interface Finish {
  /** 紙の粗さ */
  paper: number;
  /** インキに覆われた所の粗さ */
  ink: number;
  /** PP 加工の透明な層 */
  clearcoat: number;
  clearcoatRoughness: number;
  /** 紙とインキの表面の反射の強さ */
  specularIntensity: number;
}

const PAPER: Record<Paper, { paper: number; ink: number }> = {
  coat: { paper: 0.22, ink: 0.2 },
  matte: { paper: 0.4, ink: 0.33 },
  plain: { paper: 0.55, ink: 0.55 },
  special: { paper: 0.6, ink: 0.6 },
};
/** 乾式トナーは紙より光る */
const TONER = 0.32;
const FILM: Record<Pp, number> = { none: 0, gloss: 0.1, mattepp: 0.4 };

export function finish(paper: Paper, method: Method, pp: Pp): Finish {
  const base = PAPER[paper], laminated = pp !== 'none';
  return {
    paper: base.paper,
    ink: method === 'inkjet' ? base.paper : method === 'ondemand' ? Math.min(base.ink, TONER) : base.ink,
    clearcoat: laminated ? 1 : 0,
    clearcoatRoughness: FILM[pp],
    // フィルムを貼ると紙やインキは空気に触れず、表面で反射するのはフィルムだけになる
    specularIntensity: laminated ? 0 : 1,
  };
}

/**
 * 測色値にすでに含まれている表面反射の反射率。
 * 測色は 45° で照らして 0° で測るため、粗い面で散った光の一部が色の値に入っている。
 * 立体表示では表面反射を別に描くので、二重に数えないようこの分を色から引く。
 */
export function included(roughness: number) {
  const a2 = roughness ** 4, light = Math.SQRT1_2, half = Math.cos(Math.PI / 8);
  const d = a2 / (Math.PI * (half * half * (a2 - 1) + 1) ** 2);
  const v = 0.5 / (light * Math.sqrt(a2 + (1 - a2)) + Math.sqrt(a2 + (1 - a2) * light * light));
  return Math.PI * d * v * (0.04 + 0.96 * (1 - half) ** 5);
}
/** 表面の画像の B に入れる時の、255 に当たる反射率 */
export const INCLUDED_MAX = 0.05;

/** 画素ごとにインキに覆われた面積率（0〜255）。4 色がそれぞれ独立に載るとみなす */
export function coverage(cmyk: Uint8Array) {
  const out = new Uint8Array(cmyk.length / 4);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = Math.round(255 - ((255 - cmyk[j]) * (255 - cmyk[j + 1]) * (255 - cmyk[j + 2]) * (255 - cmyk[j + 3])) / 255 ** 3);
  }
  return out;
}

/** 紙の表面の画像。R は色域外のマスク、G は粗さ、B は測色値に含まれている表面反射 */
export function surfaceMap(ink: Uint8Array, mask: Uint8ClampedArray, f: Finish) {
  const out = new Uint8Array(ink.length * 4);
  const [paper, inked] = (f.clearcoat ? [f.clearcoatRoughness, f.clearcoatRoughness] : [f.paper, f.ink]).map(r => included(r) / INCLUDED_MAX);
  const haze = Uint8Array.from({ length: 256 }, (_, k) => Math.round(255 * (paper + ((inked - paper) * k) / 255)));
  const base = f.paper * 255, span = f.ink - f.paper;
  for (let i = 0, o = 0; i < ink.length; i++, o += 4) {
    out[o] = mask[o + 3];
    out[o + 1] = Math.round(base + span * ink[i]);
    out[o + 2] = haze[ink[i]];
    out[o + 3] = 255;
  }
  return out;
}

/** 用途ごとの代表的な紙の大きさ（名刺、B2、A4、A5 の長辺）と厚さ。単位は m */
export const SHEET: Record<Use, { long: number; thickness: number }> = {
  card: { long: 0.091, thickness: 0.0003 },
  poster: { long: 0.728, thickness: 0.00015 },
  flyer: { long: 0.297, thickness: 0.00009 },
  book: { long: 0.21, thickness: 0.0001 },
};
