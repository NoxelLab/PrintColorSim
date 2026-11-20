import { readFileSync } from 'node:fs';
import * as L from 'lcms-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ABSOLUTE, CMYK8, Cms, LABF, RELATIVE, RGB8 } from '../src/worker/cms';
import { FileError, open as openSource } from '../src/worker/document';
import { extract } from '../src/worker/icc-extract';
import { deltaE2000 } from '../src/worker/lab';
import { type ProofParams, proof } from '../src/worker/proof';

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/${name}`));
const profile = (name: string) => new Uint8Array(readFileSync(`public/profiles/${name}`));
const pixel = (r: { data: Uint8Array; ch: number; w: number }, x: number, y: number) => [...r.data.subarray((y * r.w + x) * r.ch, (y * r.w + x + 1) * r.ch)];

describe('deltaE2000', () => {
  // Sharma, Wu, Dalal (2005) の検証データ
  it.each([
    [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425],
    [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
    [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0],
    [50, 0, 0, 50, -1, 2, 2.3669],
    [50, 2.5, 0, 50, 0, -2.5, 4.3065],
    [50, 2.5, 0, 73, 25, -18, 27.1492],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
  ])('%d %d %d / %d %d %d', (L1, a1, b1, L2, a2, b2, expected) => {
    expect(deltaE2000(L1, a1, b1, L2, a2, b2)).toBeCloseTo(expected, 4);
  });
});

describe('extract', () => {
  const adobe = profile('AdobeCompat-v4.icc');
  it.each(['rgb-adobe.png', 'rgb-adobe.jpg', 'rgb-adobe.tif', 'rgb-adobe.psd'])('%s の埋め込みプロファイル', async name => {
    expect((await extract(fixture(name))).icc).toEqual(adobe);
  });
  it('埋め込みのないファイル', async () => {
    expect((await extract(fixture('cmyk.jpg'))).icc).toBeNull();
  });
  it('EXIF の向き', async () => {
    expect((await extract(fixture('rot6.jpg'))).orientation).toBe(6);
  });
});

describe('open', () => {
  const print = { key: 'fogra39', icc: profile('ISOcoated_v2_bas.ICC') };
  const wide = profile('Rec2020-v4.icc');
  const open = (bytes: Uint8Array) => openSource(bytes, wide);

  it.each(['cmyk.jpg', 'cmyk.tif', 'cmyk.psd'])('%s の CMYK 値を保つ', async name => {
    const source = await open(fixture(name));
    expect(source.space).toBe('cmyk');
    const { orig, sep } = source.rasters(0, 4096, print);
    expect(pixel(orig, 2, 2)).toEqual([51, 102, 153, 26]);
    expect(sep).toBe(orig.data);
  });

  it('RGB 画像の値と埋め込みプロファイル', async () => {
    const source = await open(fixture('rgb-adobe.png'));
    expect(source.space).toBe('rgb');
    expect(source.embedded).toEqual(profile('AdobeCompat-v4.icc'));
    const { orig, sep } = source.rasters(0, 4096, print);
    expect(pixel(orig, 2, 2)).toEqual([200, 30, 90]);
    expect(sep).toBeNull();
  });

  it('アルファを白地に合成する', async () => {
    const { orig } = (await open(fixture('alpha.png'))).rasters(0, 4096, print);
    expect(pixel(orig, 0, 0)).toEqual([255, 127, 127]);
  });

  it('EXIF の向きを反映する', async () => {
    const { orig } = (await open(fixture('rot6.jpg'))).rasters(0, 4096, print);
    expect([orig.w, orig.h]).toEqual([16, 32]);
    expect(pixel(orig, 8, 2)[2]).toBeGreaterThan(200);
    expect(pixel(orig, 8, 30)[0]).toBeGreaterThan(200);
  });

  it('縮小した画素を返す', async () => {
    const { orig } = (await open(fixture('rgb-adobe.png'))).rasters(0, 32, print);
    expect([orig.w, orig.h]).toEqual([32, 24]);
    expect(pixel(orig, 2, 2)).toEqual([200, 30, 90]);
  });

  it('アルファ付きの CMYK PSD は非対応', async () => {
    await expect(open(fixture('cmyk-alpha.psd'))).rejects.toEqual(new FileError('unsupported'));
  });

  it('PDF の DeviceCMYK の値を保ち RGB を印刷条件へ変換する', async () => {
    const source = await open(fixture('test.pdf'));
    expect([source.space, source.pages, source.embedded]).toEqual(['pdf', 2, null]);
    const { orig, sep } = source.rasters(0, 200, print);
    expect([orig.w, orig.h, orig.ch]).toEqual([200, 100, 3]);
    const cmyk = { data: sep!, ch: 4, w: 200 };
    for (const [i, v] of [51, 102, 153, 25].entries()) expect(Math.abs(pixel(cmyk, 50, 50)[i] - v)).toBeLessThanOrEqual(1);
    for (const [i, v] of [0, 234, 248, 0].entries()) expect(Math.abs(pixel(cmyk, 150, 50)[i] - v)).toBeLessThanOrEqual(3);
  });
});

describe('proof', () => {
  let cms: Cms;
  const params: ProofParams = {
    source: 'srgb', print: 'gracol', display: 'srgb', intent: RELATIVE, bpc: true,
    film: null, paperWhite: true, tint: null, threshold: 5, warn: [255, 0, 255],
  };
  beforeAll(async () => {
    cms = await Cms.create();
    expect(cms.set('gracol', profile('GRACoL2013_CRPC6.icc'))).toEqual({ name: 'GRACoL2013_CRPC6.icc', space: 'CMYK' });
    expect(cms.set('bad', new Uint8Array(200))).toBeNull();
  });

  it('sRGB を印刷条件へ変換し色域外を判定する', () => {
    // 赤、青、白、中間グレー
    const orig = { w: 4, h: 1, ch: 3 as const, data: new Uint8Array([255, 0, 0, 0, 0, 255, 255, 255, 255, 128, 128, 128]) };
    const r = proof(cms, 'a', orig, null, params);
    expect([...r.cmyk.subarray(0, 4)].map(v => Math.round(v / 2.55))).toEqual([0, 93, 98, 0]);
    expect([...r.cmyk.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
    expect([...r.left.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    // 紙白を反映した白は画面の白より暗い
    expect(r.right[8]).toBeLessThan(250);
    expect(r.right[8]).toBeGreaterThan(225);
    // 純色の青は色域外、白とグレーは色域内
    expect([1, 2, 3].map(i => r.mask[i * 4 + 3] > 0)).toEqual([true, false, false]);
  });

  it('紙白を反映しない場合は白が画面の白になる', () => {
    const orig = { w: 1, h: 1, ch: 3 as const, data: new Uint8Array([255, 255, 255]) };
    expect([...proof(cms, 'b', orig, null, { ...params, paperWhite: false }).right]).toEqual([255, 255, 255, 255]);
  });

  it('CMYK の元データを同じ条件で刷る場合は色域外にならない', () => {
    const data = new Uint8Array([51, 102, 153, 26, 255, 255, 255, 255, 0, 0, 0, 0, 255, 0, 128, 0]);
    const r = proof(cms, 'c', { w: 4, h: 1, ch: 4, data }, data, { ...params, source: 'gracol' });
    expect(r.flagged).toBe(0);
    expect(r.cmyk).toBe(data);
  });

  it('CMYK だけの PDF は色域外にならない', async () => {
    const fogra = profile('ISOcoated_v2_bas.ICC'), wide = profile('Rec2020-v4.icc');
    cms.set('fogra39', fogra);
    cms.set('rec2020', wide);
    const { orig, sep } = (await openSource(fixture('test.pdf'), wide)).rasters(1, 100, { key: 'fogra39', icc: fogra });
    const r = proof(cms, 'pdf', orig, sep, { ...params, source: 'rec2020', print: 'fogra39' });
    expect([...r.cmyk.subarray(0, 4)]).toEqual([255, 0, 127, 0]);
    expect(r.flagged).toBe(0);
  });

  it('キャッシュを使っても結果が変わらない', () => {
    const orig = { w: 2, h: 1, ch: 3 as const, data: new Uint8Array([10, 200, 90, 250, 240, 30]) };
    const cache = {};
    const first = proof(cms, 'd', orig, null, params, cache);
    const plain = proof(cms, 'd', orig, null, { ...params, paperWhite: false }, cache);
    expect(plain.left).toBe(first.left);
    expect(plain.right).not.toEqual(first.right);
    expect(proof(cms, 'd', orig, null, params, cache).right).toEqual(first.right);
  });

  it.each([[true, ABSOLUTE], [false, RELATIVE]])('Little CMS の校正用の変換と同じ色になる（紙白 %s）', async (paperWhite, proofIntent) => {
    const grid: number[] = [];
    for (let r = 0; r < 9; r++) for (let g = 0; g < 9; g++) for (let b = 0; b < 9; b++) grid.push(Math.min(255, r * 32 + 5), Math.min(255, g * 32 + 3), Math.min(255, b * 32 + 7));
    const data = new Uint8Array(grid), n = data.length / 3;
    const ours = proof(cms, 'e', { w: n, h: 1, ch: 3, data }, null, { ...params, print: 'fogra39', paperWhite }).right;

    const lcms: any = await L.instantiate(), K: any = L, bytes = profile('ISOcoated_v2_bas.ICC');
    const srgb = lcms.cmsCreate_sRGBProfile(), print = lcms.cmsOpenProfileFromMem(bytes, bytes.length);
    const transform = lcms.cmsCreateProofingTransform(srgb, K.TYPE_RGB_8, srgb, K.TYPE_RGB_8, print, RELATIVE, proofIntent, K.cmsFLAGS_SOFTPROOFING | K.cmsFLAGS_BLACKPOINTCOMPENSATION);
    const input = lcms._malloc(data.length), output = lcms._malloc(data.length);
    lcms.HEAPU8.set(data, input);
    lcms._cmsDoTransform(transform, input, output, n);
    const reference: Uint8Array = lcms.HEAPU8.slice(output, output + data.length);

    const rgb = new Uint8Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set(ours.subarray(i * 4, i * 4 + 3), i * 3);
    const a = cms.run(rgb, 'srgb', RGB8, 'lab', LABF, RELATIVE), b = cms.run(reference, 'srgb', RGB8, 'lab', LABF, RELATIVE);
    const de = Array.from({ length: n }, (_, i) => deltaE2000(a[i * 3], a[i * 3 + 1], a[i * 3 + 2], b[i * 3], b[i * 3 + 1], b[i * 3 + 2]));
    expect(de.reduce((x, y) => x + y, 0) / n).toBeLessThan(0.3);
    expect(Math.max(...de)).toBeLessThan(2.5);
  });

  it('PP 加工は加工後の実測値になる', () => {
    cms.set('lamMatte', profile('PSO_Coated_v2_300_Matte_laminate_eci.icc'));
    cms.set('lamGloss', profile('PSO_Coated_v2_300_Glossy_laminate_eci.icc'));
    // 黒 100%、マゼンタ 40%、紙
    const data = new Uint8Array([0, 0, 0, 255, 0, 102, 0, 0, 0, 0, 0, 0]);
    const run = (film: ProofParams['film'], print = 'fogra39') =>
      proof(cms, 'f', { w: 3, h: 1, ch: 4, data }, data, { ...params, source: print, print, film }).right;
    const shown = (id: string) => cms.run(cms.run(data, id, CMYK8, 'lab', LABF, ABSOLUTE), 'lab', LABF, 'srgb', RGB8, RELATIVE);
    for (const finished of ['lamMatte', 'lamGloss']) {
      const right = run({ finished, base: 'fogra39' });
      shown(finished).forEach((v, i) => expect(Math.abs(right[Math.floor(i / 3) * 4 + (i % 3)] - v)).toBeLessThanOrEqual(1));
    }
    // マットは黒が浅く、グロスは黒が深くなる。網点はどちらも濃くなる
    const none = run(null), matte = run({ finished: 'lamMatte', base: 'fogra39' }), gloss = run({ finished: 'lamGloss', base: 'fogra39' });
    expect(matte[1]).toBeGreaterThan(none[1] + 5);
    expect(gloss[1]).toBeLessThan(none[1] - 3);
    expect(matte[5]).toBeLessThan(none[5] - 5);
    expect(gloss[5]).toBeLessThan(none[5] - 5);
    // 加工前の条件が違う印刷条件には、加工の前後の差だけを加える
    const other = run(null, 'gracol'), laminated = run({ finished: 'lamMatte', base: 'fogra39' }, 'gracol');
    expect(Math.abs((laminated[1] - other[1]) - (matte[1] - none[1]))).toBeLessThanOrEqual(3);
  });
});
