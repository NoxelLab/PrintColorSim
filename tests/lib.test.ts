import { describe, expect, it } from 'vitest';
import { resolve, type Settings } from '../src/lib/conditions';
import { adaptation, cast, daylightXy, planckXy, type Vec3 } from '../src/lib/lighting';
import { coast, moving, REST } from '../src/lib/rotation';
import { coverage, finish, included, surfaceMap } from '../src/lib/surface';

const times = (m: number[], v: Vec3) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);

describe('conditions', () => {
  const base = { method: 'offset', paper: 'coat', pp: 'none', region: 'eu', tint: '#eff1f4' } as Settings;
  const approx = (s: Partial<Settings>, mode: 'preset' | 'custom' = 'preset') => resolve({ ...base, ...s }, mode).approx;

  it('標準の測色データがある条件は目安にしない', () => {
    expect(approx({})).toBe(false);
    expect(approx({ paper: 'matte' })).toBe(false);
    expect(approx({ paper: 'plain' })).toBe(false);
    expect(approx({ region: 'us' })).toBe(false);
    expect(approx({ pp: 'mattepp' })).toBe(false);
    expect(approx({ paper: 'matte', pp: 'gloss' })).toBe(false);
  });

  it('標準の測色データがない条件は目安にする', () => {
    expect(approx({ region: 'jp' })).toBe(true);
    expect(approx({ method: 'ondemand' })).toBe(true);
    expect(approx({ method: 'inkjet' })).toBe(true);
    expect(approx({ paper: 'special' })).toBe(true);
    expect(approx({ paper: 'plain', pp: 'gloss' })).toBe(true);
    expect(approx({ region: 'us', pp: 'gloss' })).toBe(true);
    expect(approx({ pp: 'gloss' }, 'custom')).toBe(true);
    expect(approx({ method: 'inkjet' }, 'custom')).toBe(false);
  });

  it('PP 加工は加工後のプロファイルを選ぶ', () => {
    expect(resolve({ ...base, pp: 'gloss' }, 'preset').film).toEqual({ finished: 'lamGloss', base: 'fogra39' });
    expect(resolve(base, 'preset').film).toBeNull();
  });
});

describe('lighting', () => {
  it('昼光軌跡の 6504K が D65 になる', () => {
    const [x, y] = daylightXy(6504);
    expect(x).toBeCloseTo(0.3127, 3);
    expect(y).toBeCloseTo(0.329, 3);
  });

  it('黒体軌跡の 2856K が A 光源になる', () => {
    const [x, y] = planckXy(2856);
    expect(Math.abs(x - 0.44757)).toBeLessThan(0.002);
    expect(Math.abs(y - 0.40745)).toBeLessThan(0.002);
  });

  it('照度から順応度を求める', () => {
    expect(adaptation(500)).toBeCloseTo(0.875, 2);
    expect(adaptation(100)).toBeCloseTo(0.836, 2);
    expect(adaptation(100000)).toBe(1);
  });

  it.each(['srgb', 'p3'] as const)('%s：屋外は色かぶりが残らない', space => {
    const { matrix, color } = cast('sun', space);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(matrix[i]).toBeCloseTo(v, 3));
    color.forEach(v => expect(v).toBeCloseTo(1, 3));
  });

  it.each(['srgb', 'p3'] as const)('%s：電球色は暖かい色かぶりが残り、白は光の色になる', space => {
    const { matrix, color } = cast('warm', space);
    expect(color[0]).toBeGreaterThan(color[1]);
    expect(color[1]).toBeGreaterThan(color[2]);
    times(matrix, [1, 1, 1]).forEach(v => expect(v).toBeCloseTo(1, 6));
  });
});

describe('surface', () => {
  it('インキの面積率', () => {
    expect([...coverage(new Uint8Array([0, 0, 0, 0, 255, 0, 0, 0, 128, 128, 0, 0]))]).toEqual([0, 255, 192]);
  });

  it('面積率 0% と 100% が紙とインキの粗さになる', () => {
    const f = finish('matte', 'offset', 'none');
    const map = surfaceMap(new Uint8Array([0, 255]), new Uint8ClampedArray([0, 0, 0, 200, 0, 0, 0, 0]), f);
    expect(map[1]).toBe(Math.round(f.paper * 255));
    expect(map[5]).toBe(Math.round(f.ink * 255));
    expect([map[0], map[4]]).toEqual([200, 0]);
  });

  it('測色値に含まれる表面反射は粗い面ほど多い', () => {
    // マット PP の実測（FOGRA49）では、黒の反射率が加工前より約 1.5% 高い
    expect(included(0.4)).toBeCloseTo(0.0127, 3);
    expect(included(0.1)).toBeLessThan(0.0005);
    expect(included(0.55)).toBeGreaterThan(included(0.4));
  });

  it('トナーは紙より光り、インクジェットは紙と同じ', () => {
    expect(finish('plain', 'ondemand', 'none').ink).toBeLessThan(finish('plain', 'offset', 'none').ink);
    expect(finish('matte', 'inkjet', 'none').ink).toBe(finish('matte', 'inkjet', 'none').paper);
    expect(finish('coat', 'offset', 'gloss')).toMatchObject({ clearcoat: 1, clearcoatRoughness: 0.1 });
  });
});

describe('rotation', () => {
  it('慣性は決まった回数のうちに止まる', () => {
    let m = { pose: REST, velocity: { yaw: 600, pitch: -400 } };
    let frames = 0;
    while (moving(m) && frames < 200) { m = coast(m, 1 / 60); frames++; }
    expect(moving(m)).toBe(false);
    expect(frames).toBeLessThan(120);
  });
});
