import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Cms, RELATIVE } from '../src/worker/cms';
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
    chroma: 1, lift: 0, paperWhite: true, tint: null, threshold: 5, warn: [255, 0, 255],
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
    const lifted = proof(cms, 'd', orig, null, { ...params, lift: 4 }, cache);
    expect(lifted.left).toBe(first.left);
    expect(lifted.right).not.toEqual(first.right);
    expect(proof(cms, 'd', orig, null, params, cache).right).toEqual(first.right);
  });
});
