import { ABSOLUTE, BPC, CMYK8, type Cms, LABF, RELATIVE, RGB8 } from './cms';
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
  /** 近似補正：彩度の倍率と最暗部の明度の加算値 */
  chroma: number;
  lift: number;
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

const format = (ch: number) => (ch === 3 ? RGB8 : CMYK8);

function rgba(rgb: Uint8Array) {
  const out = new Uint8ClampedArray((rgb.length / 3) * 4);
  for (let i = 0, o = 0; i < rgb.length; i += 3, o += 4) {
    out[o] = rgb[i]; out[o + 1] = rgb[i + 1]; out[o + 2] = rgb[i + 2]; out[o + 3] = 255;
  }
  return out;
}

/** プロファイルの最暗部の明度。CMYK は sRGB の黒を変換して得られるインキの組み合わせで求める。 */
function blackL(cms: Cms, profile: string, ch: number) {
  const black = ch === 3 ? new Uint8Array(3) : cms.run(new Uint8Array(3), 'srgb', RGB8, profile, CMYK8, RELATIVE, BPC);
  return cms.run(black, profile, format(ch), 'lab', LABF, RELATIVE)[0];
}

/** 白色点で正規化した XYZ の比で表した紙色 */
function paper(cms: Cms, p: ProofParams): [number, number, number] | null {
  const lab = p.tint ? cms.run(new Uint8Array(p.tint), 'srgb', RGB8, 'lab', LABF, RELATIVE)
    : p.paperWhite ? cms.run(new Uint8Array(4), p.print, CMYK8, 'lab', LABF, ABSOLUTE) : null;
  if (!lab) return null;
  const fy = (lab[0] + 16) / 116;
  return [fromF(fy + lab[1] / 500), fromF(fy), fromF(fy - lab[2] / 200)];
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
    const y = fromF((blackL(cms, p.source, orig.ch) + 16) / 116);
    if (y > 1e-4) normalize(lab, y);
    return lab;
  });

  const sepKey = sep ? `${src}|sep|${p.print}` : `${sourceKey}|${p.print}|${p.intent}|${p.bpc}`;
  const cmyk = memo('cmyk', sepKey, () => sep ?? (cms.run(orig.data, p.source, RGB8, p.print, CMYK8, p.intent, p.bpc ? BPC : 0) as Uint8Array));
  const sepLab = memo('sepLab', sepKey, () => cms.run(cmyk, p.print, CMYK8, 'lab', LABF, RELATIVE) as Float32Array);

  const finalKey = [sepKey, p.display, p.chroma, p.lift, p.paperWhite, p.tint, p.threshold, p.warn].join('|');
  const final = memo('final', finalKey, () => {
    const n = orig.w * orig.h;
    const out = new Float32Array(n * 3), mask = new Uint8ClampedArray(n * 4);
    const white = paper(cms, p);
    const kL = blackL(cms, p.print, 4);
    const blackY = fromF((kL + p.lift * (1 - kL / 100) + 16) / 116), scale = 1 / (1 - blackY);
    const quick = (p.threshold / 1.6) ** 2;
    let flagged = 0;
    for (let i = 0, q = 0; q < n; i += 3, q++) {
      const L = sepLab[i] + p.lift * (1 - sepLab[i] / 100), a = sepLab[i + 1] * p.chroma, b = sepLab[i + 2] * p.chroma;
      const fy = (L + 16) / 116;
      const x = fromF(fy + a / 500), y = fromF(fy), z = fromF(fy - b / 200);

      const oL = origLab[i], oa = origLab[i + 1], ob = origLab[i + 2];
      const cx = toF(Math.max(0, (x - blackY) * scale)), cy = toF(Math.max(0, (y - blackY) * scale)), cz = toF(Math.max(0, (z - blackY) * scale));
      const cL = 116 * cy - 16, ca = 500 * (cx - cy), cb = 200 * (cy - cz);
      if ((cL - oL) ** 2 + (ca - oa) ** 2 + (cb - ob) ** 2 > quick && deltaE2000(oL, oa, ob, cL, ca, cb) > p.threshold) {
        flagged++;
        const m = q * 4;
        mask[m] = p.warn[0]; mask[m + 1] = p.warn[1]; mask[m + 2] = p.warn[2];
        mask[m + 3] = ((q % orig.w) + ((q / orig.w) | 0)) % 12 < 6 ? 235 : 110;
      }

      if (white) {
        const wx = toF(x * white[0]), wy = toF(y * white[1]), wz = toF(z * white[2]);
        out[i] = 116 * wy - 16; out[i + 1] = 500 * (wx - wy); out[i + 2] = 200 * (wy - wz);
      } else {
        out[i] = L; out[i + 1] = a; out[i + 2] = b;
      }
    }
    return { right: rgba(cms.run(out, 'lab', LABF, p.display, RGB8, RELATIVE) as Uint8Array), mask, flagged };
  });

  return { left, ...final, cmyk };
}
