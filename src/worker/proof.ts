import { ABSOLUTE, BPC, CMYK8, CMYK16, type Cms, HIGHRES, LABF, RELATIVE, RGB8 } from './cms';
import { deltaE2000, fromF, toF } from './lab';

export interface Raster { w: number; h: number; ch: 3 | 4; data: Uint8Array }

export interface ProofParams {
  /** 元データのプロファイル ID */
  source: string;
  /** 印刷条件のプロファイル ID */
  print: string;
  /** 表示色空間のプロファイル ID */
  display: string;
  intent: number;
  bpc: boolean;
  /** PP 加工。加工後の測色値を持つプロファイルと、その加工前の条件のプロファイルの ID */
  film: { finished: string; base: string } | null;
  paperWhite: boolean;
  /** 特殊紙の紙色（sRGB） */
  tint: [number, number, number] | null;
  threshold: number;
  warn: [number, number, number];
}

export interface ProofResult {
  left: Uint8ClampedArray;
  right: Uint8ClampedArray;
  mask: Uint8ClampedArray;
  flagged: number;
  cmyk: Uint8Array;
}

export type ProofCache = Record<string, { key: string; value: unknown }>;

const STEP = 1 << 18;

const format = (ch: number) => (ch === 3 ? RGB8 : CMYK8);

function rgba(rgb: Uint8Array) {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    out[o] = rgb[i]; out[o + 1] = rgb[i + 1]; out[o + 2] = rgb[i + 2]; out[o + 3] = 255;
  }
  return out;
}

/** D50 の白で正規化した XYZ */
function xyz(lab: ArrayLike<number>): [number, number, number] {
  const fy = (lab[0] + 16) / 116;
  return [fromF(fy + lab[1] / 500), fromF(fy), fromF(fy - lab[2] / 200)];
}

/** プロファイルで最も暗い色。CMYK は sRGB の黒を変換して得られるインキの組み合わせとする。 */
const darkest = (cms: Cms, profile: string, ch: number) =>
  ch === 3 ? new Uint8Array(3) : (cms.run(new Uint8Array(3), 'srgb', RGB8, profile, CMYK8, RELATIVE, BPC) as Uint8Array);

/**
 * 印刷条件での CMYK の絶対測色値（Lab）。
 * PP 加工は、加工の前後の測色値の差を印刷条件の値に加える。加工前の条件が印刷条件と同じなら、加工後の測色値そのものになる。
 */
function measure(cms: Cms, p: ProofParams, cmyk: Uint8Array, cmykFormat: number) {
  const { film } = p;
  if (!film) return cms.run(cmyk, p.print, cmykFormat, 'lab', LABF, ABSOLUTE) as Float32Array;
  const bytes = cmykFormat === CMYK16 ? 8 : 4, n = cmyk.length / bytes;
  const out = new Float32Array(n * 3);
  for (let from = 0; from < n; from += STEP) {
    const part = cmyk.subarray(from * bytes, Math.min(n, from + STEP) * bytes);
    const lab = (profile: string) => cms.run(part, profile, cmykFormat, 'lab', LABF, ABSOLUTE);
    const print = lab(p.print), finished = lab(film.finished), base = lab(film.base);
    for (let i = 0, o = from * 3; i < print.length; i++, o++) out[o] = print[i] + finished[i] - base[i];
  }
  return out;
}

/** 最暗部を 0 に合わせた Lab へ書き換える。黒点補正後の階調どうしで色差を比べるために使う。 */
function normalize(lab: Float32Array, blackY: number) {
  const scale = 1 / (1 - blackY);
  for (let i = 0; i < lab.length; i += 3) {
    const fy = (lab[i] + 16) / 116;
    const x = toF(Math.max(0, (fromF(fy + lab[i + 1] / 500) - blackY) * scale));
    const y = toF(Math.max(0, (fromF(fy) - blackY) * scale));
    const z = toF(Math.max(0, (fromF(fy - lab[i + 2] / 200) - blackY) * scale));
    lab[i] = 116 * y - 16; lab[i + 1] = 500 * (x - y); lab[i + 2] = 200 * (y - z);
  }
}

/**
 * 元データから左右の表示用画素と色域外のマスクを求める。
 * sep を渡した場合はそれを分版として使い、渡さない場合は元データを印刷条件へ変換する。
 */
export function proof(cms: Cms, src: string, orig: Raster, sep: Uint8Array | null, p: ProofParams, cache?: ProofCache): ProofResult {
  const memo = <T>(stage: string, key: string, make: () => T): T => {
    const hit = cache?.[stage];
    if (hit?.key === key) return hit.value as T;
    const value = make();
    if (cache) cache[stage] = { key, value };
    return value;
  };
  const from = format(orig.ch);
  const sourceKey = `${src}|${p.source}`;

  const left = memo('left', `${sourceKey}|${p.display}`, () => rgba(cms.run(orig.data, p.source, from, p.display, RGB8, RELATIVE, BPC) as Uint8Array));

  const origLab = memo('origLab', sourceKey, () => {
    const lab = cms.run(orig.data, p.source, from, 'lab', LABF, RELATIVE) as Float32Array;
    const y = xyz(cms.run(darkest(cms, p.source, orig.ch), p.source, from, 'lab', LABF, RELATIVE))[1];
    if (y > 1e-4) normalize(lab, y);
    return lab;
  });

  const sepKey = `${sep ? `${src}|sep` : `${sourceKey}|${p.intent}|${p.bpc}`}|${p.print}|${p.film?.finished}`;
  // 元データから変換する場合は 16bit の CMYK を経由し、8bit に丸めることによる誤差と階調の段差を避ける
  const { cmyk, printed } = memo('sep', sepKey, () => {
    if (sep) return { cmyk: sep, printed: measure(cms, p, sep, CMYK8) };
    const wide = cms.run(orig.data, p.source, RGB8, p.print, CMYK16, p.intent, (p.bpc ? BPC : 0) | HIGHRES) as Uint8Array;
    const levels = new Uint16Array(wide.buffer), narrow = new Uint8Array(levels.length);
    for (let i = 0; i < levels.length; i++) narrow[i] = (levels[i] + 128) / 257;
    return { cmyk: narrow, printed: measure(cms, p, wide, CMYK16) };
  });

  const finalKey = [sepKey, p.display, p.paperWhite, p.tint, p.threshold, p.warn].join('|');
  const final = memo('final', finalKey, () => {
    const n = orig.w * orig.h;
    const out = new Float32Array(n * 3), mask = new Uint8ClampedArray(n * 4);
    // 紙白と最暗部。色域外の判定は、紙白を 1、最暗部を 0 に合わせた階調で行う
    const white = xyz(measure(cms, p, new Uint8Array(4), CMYK8));
    const blackY = xyz(measure(cms, p, darkest(cms, p.print, 4), CMYK8))[1] / white[1], scale = 1 / (1 - blackY);
    // 表示する紙の色。紙白を再現しない時は紙を表示の白に合わせる
    const shown = p.tint ? xyz(cms.run(new Uint8Array(p.tint), 'srgb', RGB8, 'lab', LABF, RELATIVE)) : p.paperWhite ? white : [1, 1, 1];
    const quick = (p.threshold / 1.6) ** 2;
    let flagged = 0;
    for (let i = 0, q = 0; q < n; i += 3, q++) {
      const fy = (printed[i] + 16) / 116;
      const x = fromF(fy + printed[i + 1] / 500) / white[0], y = fromF(fy) / white[1], z = fromF(fy - printed[i + 2] / 200) / white[2];

      const oL = origLab[i], oa = origLab[i + 1], ob = origLab[i + 2];
      const cx = toF(Math.max(0, (x - blackY) * scale)), cy = toF(Math.max(0, (y - blackY) * scale)), cz = toF(Math.max(0, (z - blackY) * scale));
      const cL = 116 * cy - 16, ca = 500 * (cx - cy), cb = 200 * (cy - cz);
      if ((cL - oL) ** 2 + (ca - oa) ** 2 + (cb - ob) ** 2 > quick && deltaE2000(oL, oa, ob, cL, ca, cb) > p.threshold) {
        flagged++;
        const m = q * 4;
        mask[m] = p.warn[0]; mask[m + 1] = p.warn[1]; mask[m + 2] = p.warn[2];
        mask[m + 3] = ((q % orig.w) + ((q / orig.w) | 0)) % 12 < 6 ? 235 : 110;
      }

      const sx = toF(x * shown[0]), sy = toF(y * shown[1]), sz = toF(z * shown[2]);
      out[i] = 116 * sy - 16; out[i + 1] = 500 * (sx - sy); out[i + 2] = 200 * (sy - sz);
    }
    return { right: rgba(cms.run(out, 'lab', LABF, p.display, RGB8, RELATIVE) as Uint8Array), mask, flagged };
  });

  return { left, ...final, cmyk };
}
