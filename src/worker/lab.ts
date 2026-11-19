const E = 6 / 29;

/** 白色点で正規化した XYZ の1成分と Lab の f 値の相互変換 */
export const fromF = (t: number) => (t > E ? t * t * t : 3 * E * E * (t - 4 / 29));
export const toF = (t: number) => (t > E * E * E ? Math.cbrt(t) : t / (3 * E * E) + 4 / 29);

const RAD = Math.PI / 180;
const POW25_7 = 25 ** 7;
const hue = (b: number, a: number) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / RAD + 360) % 360);

export function deltaE2000(L1: number, a1: number, b1: number, L2: number, a2: number, b2: number): number {
  const cm7 = ((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2) ** 7;
  const g = 0.5 * (1 - Math.sqrt(cm7 / (cm7 + POW25_7)));
  const a1p = (1 + g) * a1, a2p = (1 + g) * a2;
  const c1 = Math.hypot(a1p, b1), c2 = Math.hypot(a2p, b2);
  const h1 = hue(b1, a1p), h2 = hue(b2, a2p);
  const chromatic = c1 * c2 !== 0;

  let dh = chromatic ? h2 - h1 : 0;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dL = L2 - L1, dC = c2 - c1, dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * RAD);

  let hm = h1 + h2;
  if (chromatic) hm = Math.abs(h1 - h2) <= 180 ? hm / 2 : (hm + (hm < 360 ? 360 : -360)) / 2;
  const Lm = (L1 + L2) / 2, cm = (c1 + c2) / 2;
  const t = 1 - 0.17 * Math.cos((hm - 30) * RAD) + 0.24 * Math.cos(2 * hm * RAD)
    + 0.32 * Math.cos((3 * hm + 6) * RAD) - 0.2 * Math.cos((4 * hm - 63) * RAD);
  const cmp7 = cm ** 7;
  const rt = -Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * RAD) * 2 * Math.sqrt(cmp7 / (cmp7 + POW25_7));
  const sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const sc = 1 + 0.045 * cm, sh = 1 + 0.015 * cm * t;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}
