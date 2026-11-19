import type { Light } from './conditions';

export type Vec3 = [number, number, number];
/** 行優先の 3×3 行列 */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Space = 'srgb' | 'p3';

const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

const product = (a: Mat3, b: Mat3): Mat3 => {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
};

const inverse = (m: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = f * g - d * i, C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, c * h - b * i, b * f - c * e, B, a * i - c * g, c * d - a * f, C, b * g - a * h, a * e - b * d].map(v => v / det) as Mat3;
};

const diagonal = (v: Vec3): Mat3 => [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];

/** 線形 RGB（白は D65）から XYZ への行列 */
export const RGB_TO_XYZ: Record<Space, Mat3> = {
  srgb: [0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041],
  p3: [0.4865709, 0.2656677, 0.1982173, 0.2289746, 0.6917385, 0.0792869, 0, 0.0451134, 1.0439444],
};

/** CAT16 の錐体応答への行列 */
const CAT16: Mat3 = [0.401288, 0.650173, -0.051461, -0.250268, 1.204414, 0.045854, -0.002079, 0.048952, 0.953127];

export const xyToXyz = (x: number, y: number): Vec3 => [x / y, 1, (1 - x - y) / y];

/** 黒体（プランク）軌跡の色度。Kim ら（2002）の近似で、1667〜25000K で使える */
export function planckXy(t: number): [number, number] {
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039;
  const y = t <= 2222
    ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000
      ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
  return [x, y];
}

/** CIE 昼光軌跡の色度。4000〜25000K で使える */
export function daylightXy(t: number): [number, number] {
  const x = t <= 7000
    ? -4.607e9 / t ** 3 + 2.9678e6 / t ** 2 + 0.09911e3 / t + 0.244063
    : -2.0064e9 / t ** 3 + 1.9018e6 / t ** 2 + 0.24748e3 / t + 0.23704;
  return [x, -3 * x * x + 2.87 * x - 0.275];
}

/** 順応度。CIECAM16 の式で、周囲は平均的、背景の反射率は 20% とする */
export function adaptation(lux: number) {
  const la = (0.2 * lux) / Math.PI;
  return Math.min(1, Math.max(0, 1 - Math.exp((-la - 42) / 92) / 3.6));
}

export interface Illuminant {
  locus: 'daylight' | 'planck';
  /** 相関色温度（K） */
  cct: number;
  /** 照度（lx） */
  lux: number;
}

/** 照明ごとの光源。昼光は昼光軌跡、ランプは黒体軌跡の色度を使う */
export const ILLUMINANTS: Record<Light, Illuminant> = {
  sun: { locus: 'daylight', cct: 6504, lux: 100000 },
  overcast: { locus: 'daylight', cct: 6504, lux: 10000 },
  neutral: { locus: 'planck', cct: 5000, lux: 500 },
  warm: { locus: 'planck', cct: 2700, lux: 100 },
};

const D65 = xyToXyz(0.3127, 0.329);

/**
 * 目が慣れきれずに残る色かぶり。
 * 2D の再現は D50 の光に完全に慣れた見え方なので、錐体応答ごとに D + (1 − D) × 光源の白 ÷ 画面の白 を掛ける。
 * 照明は color の光で描き、基本色には matrix を掛ける。こうすると拡散反射は色かぶりを掛けた基本色、鏡面反射は color になる。
 * どちらも作業色空間の線形 RGB の値。
 */
export function cast(light: Light, space: Space) {
  const source = ILLUMINANTS[light];
  const degree = adaptation(source.lux);
  const [x, y] = source.locus === 'daylight' ? daylightXy(source.cct) : planckXy(source.cct);
  const from = apply(CAT16, xyToXyz(x, y)), to = apply(CAT16, D65);
  const gain = from.map((v, i) => degree + ((1 - degree) * v) / to[i]) as Vec3;
  const toXyz = RGB_TO_XYZ[space];
  const a = product(inverse(toXyz), product(inverse(CAT16), product(diagonal(gain), product(CAT16, toXyz))));
  const color = apply(a, [1, 1, 1]);
  return { matrix: product(diagonal([1 / color[0], 1 / color[1], 1 / color[2]]), a), color, degree };
}

const decode = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** Display P3 の 8bit RGBA を sRGB に変換する。範囲の外は切り詰める */
export function p3ToSrgb(data: Uint8ClampedArray<ArrayBuffer>) {
  const m = product(inverse(RGB_TO_XYZ.srgb), RGB_TO_XYZ.p3);
  const linear = Float64Array.from({ length: 256 }, (_, i) => decode(i / 255));
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const rgb = apply(m, [linear[data[i]], linear[data[i + 1]], linear[data[i + 2]]]);
    for (let c = 0; c < 3; c++) out[i + c] = 255 * encode(Math.min(1, Math.max(0, rgb[c])));
    out[i + 3] = data[i + 3];
  }
  return out;
}
