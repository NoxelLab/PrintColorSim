import { describe, expect, it } from 'vitest';
import { adaptation, cast, daylightXy, planckXy, type Vec3 } from '../src/lib/lighting';
import { coast, moving, REST } from '../src/lib/rotation';
import { coverage, finish, surfaceMap } from '../src/lib/surface';

const times = (m: number[], v: Vec3) => [0, 1, 2].map(r => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);

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
