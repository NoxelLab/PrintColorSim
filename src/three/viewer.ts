import {
  BackSide, BoxGeometry, Color, ColorManagement, DataTexture, DirectionalLight, LinearFilter, LinearMipmapLinearFilter,
  LinearSRGBColorSpace, MathUtils, Matrix3, Mesh, MeshPhysicalMaterial, NoColorSpace, type Object3D, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, RectAreaLight, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  DisplayP3ColorSpace, DisplayP3ColorSpaceImpl, LinearDisplayP3ColorSpace, LinearDisplayP3ColorSpaceImpl,
} from 'three/addons/math/ColorSpaces.js';
import type { Light } from '../lib/conditions';
import { cast, type Space, type Vec3 } from '../lib/lighting';
import { blend, clamp, coast, ease, type Motion, moving, type Pose, REST } from '../lib/rotation';
import { type Finish, included, INCLUDED_MAX } from '../lib/surface';

export interface Look {
  light: Light;
  finish: Finish;
  /** 紙の長辺と厚さ（m） */
  sheet: { long: number; thickness: number };
  warn: boolean;
}

export interface Viewer {
  /** 再現画像（作業色空間と同じ原色の 8bit RGBA）と紙の色（同じ色空間の 0〜255） */
  setImage(w: number, h: number, albedo: Uint8ClampedArray<ArrayBuffer>, paper: [number, number, number]): void;
  /** 表面の画像。R は色域外のマスク、G は粗さ */
  setSurface(w: number, h: number, data: Uint8Array<ArrayBuffer>): void;
  setLook(look: Look): void;
  reset(): void;
  /** 表示中の向きと照明のまま、sRGB の PNG にする */
  snapshot(): Promise<Blob>;
  dispose(): void;
}

/** 色域外の強調色（sRGB） */
const WARN = 'rgb(0, 229, 255)';
/** ステージの背景色。書き出しの下地に使う */
const BACKGROUND = '#262626';
/** 照明の選択を重ねる、ステージ下端の高さ（CSS ピクセル） */
const OVERLAY = 56;
/** 回転の感度（度/CSS ピクセル）と拡大の範囲 */
const DRAG = 0.35;
const ZOOM: [number, number] = [0.6, 3];

/**
 * 照明の配置。紙の中心を原点とし、手前を +z、上を +y とする。長さの単位は m。
 * 光の強さは照明の中での比だけに意味があり、全体の明るさは最初の向きの拡散反射を測って合わせる。
 * 光源は、最初の向きで映り込みが紙のすぐ外に来て、縁につやが見える方向に置く。
 */
interface Rig {
  /** distance は光源までの距離の倍率。大きな紙でも照明のむらが変わらないように遠ざけ、その分だけ明るくする */
  lights(color: Color, distance: number): Object3D[];
  /** 周囲からの光の放射輝度：天頂（天井）、低い空（壁の上部）、視線の高さの周囲、地面（床） */
  around: { top: Vec3; horizon: Vec3; level: Vec3; ground: Vec3 };
}

/** 下を向いた天井の照明 */
const panel = (color: Color, width: number, depth: number, position: Vec3, distance: number) => {
  const light = new RectAreaLight(color, distance ** 2, width, depth);
  light.position.set(...position).multiplyScalar(distance);
  light.rotation.x = -Math.PI / 2;
  return light;
};

const RIGS: Record<Light, Rig> = {
  // 高度 56° で左後方からの太陽。直射が全体の約 8 割で、残りが青空と日の当たった周囲からの光
  sun: {
    lights: color => {
      const sun = new DirectionalLight(color.clone().multiply(new Color(1, 0.93, 0.8)), 1);
      sun.position.set(-0.236, 0.829, 0.507).multiplyScalar(10);
      return [sun];
    },
    around: { top: [0.016, 0.028, 0.06], horizon: [0.06, 0.07, 0.085], level: [0.05, 0.048, 0.045], ground: [0.06, 0.056, 0.05] },
  },
  // CIE の標準曇天空。天頂が地平線の 3 倍明るい
  overcast: {
    lights: () => [],
    around: { top: [1, 1, 1], horizon: [0.47, 0.47, 0.47], level: [0.1, 0.1, 0.1], ground: [0.15, 0.15, 0.15] },
  },
  // 1.2m 上、2m 手前の天井に 0.6×1.2m の照明が 2 枚。壁と天井からの間接光が全体の 3〜4 割
  neutral: {
    lights: (color, d) => [0.2, 1.3].map(x => panel(color, 0.6, 1.2, [x, 1.2, 2], d)),
    around: { top: [0.02, 0.02, 0.02], horizon: [0.017, 0.017, 0.017], level: [0.017, 0.017, 0.017], ground: [0.01, 0.01, 0.01] },
  },
  // 1m 上、1.7m 手前の 0.4m 角の照明 1 灯と、暗い室内
  warm: {
    lights: (color, d) => [panel(color, 0.4, 0.4, [0.15, 1, 1.7], d)],
    around: { top: [0.002, 0.002, 0.002], horizon: [0.0015, 0.0015, 0.0015], level: [0.0015, 0.0015, 0.0015], ground: [0.001, 0.001, 0.001] },
  },
};

/** この長さまでの紙は、照明を実際の距離に置く */
const NEAR = 0.3;

/**
 * 紙の材質に加える処理。
 * balance は最初の向きの拡散反射を 2D の再現に合わせる倍率。
 * 明るさは拡散反射の白までを入力のまま出し、それより明るい照り返しだけを画面の白へ圧縮する。
 */
const HEADER = `
uniform vec3 balance;
vec3 sheetTone( vec3 color ) {
  const float knee = 0.9;
  float peak = max( color.r, max( color.g, color.b ) );
  if ( peak <= knee ) return color;
  float d = 1.0 - knee;
  float mapped = 1.0 - d * d / ( peak + d - knee );
  color *= mapped / peak;
  return mix( color, vec3( mapped ), 1.0 - 1.0 / ( 0.15 * ( peak - mapped ) + 1.0 ) );
}
`;

let prepared = false;

/** 仰角で変わる放射輝度の球。映り込みと間接光の環境を作るために使う */
function aroundScene({ top, horizon, level, ground }: Rig['around'], color: Color) {
  const tinted = (v: Vec3) => new Color(...v).multiply(color);
  const scene = new Scene();
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { top: { value: tinted(top) }, horizon: { value: tinted(horizon) }, level: { value: tinted(level) }, ground: { value: tinted(ground) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 level; uniform vec3 ground; varying vec3 vDir;
      void main() {
        float y = normalize( vDir ).y;
        vec3 sky = mix( horizon, top, clamp( ( y - 0.2 ) / 0.8, 0.0, 1.0 ) );
        // 高度 35〜50° より下は建物や壁
        vec3 c = y < 0.0 ? mix( level, ground, smoothstep( 0.0, 0.6, - y ) ) : mix( level, sky, smoothstep( 0.57, 0.77, y ) );
        gl_FragColor = vec4( c, 1.0 );
      }`,
  });
  scene.add(new Mesh(new SphereGeometry(10, 48, 24), material));
  return scene;
}

export function createViewer(canvas: HTMLCanvasElement, space: Space, reducedMotion: boolean): Viewer {
  if (!prepared) {
    ColorManagement.define({ [DisplayP3ColorSpace]: DisplayP3ColorSpaceImpl, [LinearDisplayP3ColorSpace]: LinearDisplayP3ColorSpaceImpl });
    RectAreaLightUniformsLib.init();
    prepared = true;
  }
  const working = space === 'p3' ? LinearDisplayP3ColorSpace : LinearSRGBColorSpace;
  const texelSpace = space === 'p3' ? DisplayP3ColorSpace : SRGBColorSpace;
  ColorManagement.workingColorSpace = working;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = texelSpace;
  renderer.setClearColor(0x000000, 0);
  let pmrem = new PMREMGenerator(renderer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.01, 50);
  const controller = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}) =>
    canvas.addEventListener(type, fn, { ...options, signal: controller.signal });

  // 色かぶりの行列、明るさの倍率、色域外の表示は、材質を作り直さずに uniform だけで切り替える
  const uniforms = {
    balance: { value: new Vector3(1, 1, 1) },
    castMatrix: { value: new Matrix3() },
    warnColor: { value: new Color(WARN) },
    warnOn: { value: 0 },
  };
  const material = (albedo: boolean) => {
    const m = new MeshPhysicalMaterial({ roughness: 1, metalness: 0, ior: 1.5 });
    m.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, uniforms);
      let fragment = shader.fragmentShader
        .replace('#include <opaque_fragment>', 'outgoingLight *= balance;\n#include <opaque_fragment>')
        .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = sheetTone( gl_FragColor.rgb );');
      if (albedo) {
        fragment = 'uniform mat3 castMatrix;\nuniform vec3 warnColor;\nuniform float warnOn;\n' + fragment.replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          vec4 surfaceTexel = texture2D( roughnessMap, vRoughnessMapUv );
          diffuseColor.rgb = castMatrix * max( diffuseColor.rgb - surfaceTexel.b * ${INCLUDED_MAX}, 0.0 );
          diffuseColor.rgb = mix( diffuseColor.rgb, warnColor, surfaceTexel.r * warnOn );`,
        );
      }
      shader.fragmentShader = HEADER + fragment;
    };
    m.customProgramCacheKey = () => (albedo ? 'sheet-front' : 'sheet-plain');
    return m;
  };
  const front = material(true), back = material(false), edge = material(false);
  // BoxGeometry の面の順は +x、−x、+y、−y、+z（表）、−z（裏）
  const sheet = new Mesh(new BoxGeometry(1, 1, 0.001), [edge, edge, edge, edge, front, back]);
  sheet.rotation.order = 'YXZ';
  scene.add(sheet);

  // 最初の向きに置いた小さな面。照明ごとの明るさと色を測るために使う
  const probeMaterial = new MeshPhysicalMaterial({ metalness: 0, ior: 1.5 });
  const probe = new Mesh(new PlaneGeometry(0.01, 0.01), probeMaterial);
  probe.rotation.order = 'YXZ';
  probe.rotation.set(MathUtils.degToRad(REST.pitch), MathUtils.degToRad(REST.yaw), 0);
  probe.visible = false;
  scene.add(probe);
  const probeCamera = new OrthographicCamera(-0.002, 0.002, 0.002, -0.002, 0.01, 1);
  probeCamera.position.set(0, 0, 0.5);
  const probeTarget = new WebGLRenderTarget(4, 4);
  const probePixel = new Uint8Array(4);

  let albedo: DataTexture | null = null, surface: DataTexture | null = null;
  let size = { w: 1, h: 1 }, paperRgb: [number, number, number] = [255, 255, 255];
  let look: Look | null = null, rigLights: Object3D[] = [], rigKey = '', calibrationKey = '', geometryKey = '';
  const environments = new Map<string, WebGLRenderTarget>();

  let motion: Motion = { pose: { yaw: 0, pitch: 0 }, velocity: { yaw: 0, pitch: 0 } };
  let zoom = 1, intro = true;
  let animation: { from: Pose; to: Pose; zoom: [number, number]; start: number; duration: number } | null = null;
  let frameId = 0, lastTime = 0, dragging = false;

  function texture(w: number, h: number, data: Uint8ClampedArray<ArrayBuffer> | Uint8Array<ArrayBuffer>, colorSpace: string) {
    const t = new DataTexture(data, w, h);
    t.colorSpace = colorSpace;
    t.flipY = true;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    t.needsUpdate = true;
    return t;
  }

  /** 同じ大きさなら中身だけ差し替え、違えば作り直す */
  function update(current: DataTexture | null, w: number, h: number, data: Uint8ClampedArray<ArrayBuffer> | Uint8Array<ArrayBuffer>, colorSpace: string) {
    if (current && current.image.width === w && current.image.height === h) {
      current.image.data = data;
      current.needsUpdate = true;
      return current;
    }
    current?.dispose();
    return texture(w, h, data, colorSpace);
  }

  /** 紙の幅と高さ（m） */
  function dimensions(): [number, number] {
    const long = look?.sheet.long ?? 1, aspect = size.w / size.h;
    return aspect >= 1 ? [long, long / aspect] : [long * aspect, long];
  }

  function updateGeometry() {
    const [w, h] = dimensions(), key = `${w}|${h}|${look?.sheet.thickness}`;
    if (key === geometryKey) return;
    geometryKey = key;
    sheet.geometry.dispose();
    sheet.geometry = new BoxGeometry(w, h, look?.sheet.thickness ?? 0.001);
    frame();
  }

  /** 照明の選択に隠れない範囲に、紙全体が収まる距離と位置にカメラを置く */
  function frame() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    camera.aspect = w / h;
    const [sheetW, sheetH] = dimensions();
    const reserve = Math.min(0.3, OVERLAY / h);
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const fitH = (sheetH * 1.12) / (1 - reserve), fitW = sheetW * 1.12;
    const distance = Math.max(fitH / (2 * tan), fitW / (2 * tan * camera.aspect)) / zoom;
    const shift = reserve * distance * tan;
    camera.near = distance / 20;
    camera.far = distance * 20;
    camera.position.set(0, -shift, distance);
    camera.lookAt(0, -shift, 0);
    camera.updateProjectionMatrix();
  }

  function environment(light: Light, color: Color) {
    const key = `${light}|${color.getHexString()}`;
    let target = environments.get(key);
    if (!target) {
      const around = aroundScene(RIGS[light].around, color);
      target = pmrem.fromScene(around, 0.02);
      const sphere = around.children[0] as Mesh;
      sphere.geometry.dispose();
      (sphere.material as ShaderMaterial).dispose();
      environments.set(key, target);
    }
    return target.texture;
  }

  /**
   * 最初の向きの面の白と黒を描いて読み取り、その差（拡散反射）が target になる倍率を求める。
   * 黒に残る分は表面の反射で、照明や周囲の映り込みとしてそのまま表示に加わる。
   */
  function calibrate(f: Finish, target: Vec3) {
    Object.assign(probeMaterial, { roughness: f.paper, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, specularIntensity: f.specularIntensity });
    const read = (reflectance: number): Vec3 => {
      probeMaterial.color.setScalar(reflectance);
      renderer.setRenderTarget(probeTarget);
      renderer.clear();
      renderer.render(scene, probeCamera);
      renderer.readRenderTargetPixels(probeTarget, 2, 2, 1, 1, probePixel);
      return [probePixel[0] / 255, probePixel[1] / 255, probePixel[2] / 255];
    };
    sheet.visible = false;
    probe.visible = true;
    // 8bit で読むため、読み取り値が 0.6〜0.94 に入るよう反射率を調整してから測る
    let reflectance = 1, white = read(reflectance);
    for (let i = 0; i < 4; i++) {
      const peak = Math.max(...white);
      if (peak > 0.94) reflectance /= 4;
      else if (peak < 0.6) reflectance *= 0.8 / Math.max(peak, 0.01);
      else break;
      white = read(reflectance);
    }
    const black = read(0);
    renderer.setRenderTarget(null);
    probe.visible = false;
    sheet.visible = true;
    uniforms.balance.value.set(...(target.map((t, i) => (t * reflectance) / Math.max(white[i] - black[i], 1e-4)) as Vec3));
  }

  function applyLook() {
    if (!look) return;
    const { matrix, color } = cast(look.light, space);
    const lightColor = new Color().setRGB(color[0], color[1], color[2], working);
    uniforms.castMatrix.value.set(...matrix);
    uniforms.warnOn.value = look.warn ? 1 : 0;

    const distance = Math.max(1, look.sheet.long / NEAR), key = `${look.light}|${distance}`;
    if (rigKey !== key) {
      rigKey = key;
      rigLights.forEach(l => scene.remove(l));
      rigLights = RIGS[look.light].lights(lightColor, distance);
      rigLights.forEach(l => scene.add(l));
      scene.environment = environment(look.light, lightColor);
    }

    const f = look.finish;
    Object.assign(front, { clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, specularIntensity: f.specularIntensity });
    Object.assign(back, { roughness: f.paper, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, specularIntensity: f.specularIntensity });
    Object.assign(edge, { roughness: f.paper, specularIntensity: f.specularIntensity });
    if (`${key}|${JSON.stringify(f)}` !== calibrationKey) {
      calibrationKey = `${key}|${JSON.stringify(f)}`;
      calibrate(f, [lightColor.r, lightColor.g, lightColor.b]);
    }

    // 裏と縁は紙の色に、表と同じ色かぶりを掛ける
    const paper = new Color().setRGB(paperRgb[0] / 255, paperRgb[1] / 255, paperRgb[2] / 255, texelSpace);
    const [r, g, b] = paper.toArray().map(v => Math.max(0, v - included(f.clearcoat ? f.clearcoatRoughness : f.paper))), m = matrix;
    const tinted = new Color(m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b);
    back.color.copy(tinted);
    edge.color.copy(tinted);
    updateGeometry();
  }

  function startIntro() {
    if (!intro || !albedo) return;
    intro = false;
    if (reducedMotion) motion = { pose: { ...REST }, velocity: { yaw: 0, pitch: 0 } };
    else animation = { from: { yaw: 0, pitch: 0 }, to: REST, zoom: [zoom, zoom], start: performance.now(), duration: 900 };
  }

  function invalidate() {
    if (!frameId) frameId = requestAnimationFrame(tick);
  }

  function tick(time: number) {
    frameId = 0;
    const dt = lastTime ? Math.min(0.05, (time - lastTime) / 1000) : 1 / 60;
    lastTime = time;
    let again = false;
    if (animation) {
      const t = Math.min(1, (time - animation.start) / animation.duration), k = ease(t);
      motion = { pose: blend(animation.from, animation.to, k), velocity: { yaw: 0, pitch: 0 } };
      zoom = animation.zoom[0] + (animation.zoom[1] - animation.zoom[0]) * k;
      frame();
      if (t < 1) again = true;
      else animation = null;
    } else if (!dragging && moving(motion)) {
      motion = coast(motion, dt);
      again = moving(motion);
    }
    sheet.rotation.set(MathUtils.degToRad(motion.pose.pitch), MathUtils.degToRad(motion.pose.yaw), 0);
    if (albedo && surface && look) renderer.render(scene, camera);
    if (again) invalidate();
    else lastTime = 0;
  }

  function resize() {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    frame();
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  function setZoom(next: number) {
    zoom = Math.min(ZOOM[1], Math.max(ZOOM[0], next));
    frame();
    invalidate();
  }

  function reset() {
    animation = { from: motion.pose, to: REST, zoom: [zoom, 1], start: performance.now(), duration: reducedMotion ? 1 : 450 };
    invalidate();
  }

  // 1 本指で回し、2 本指のつまみで拡大縮小する
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0, moved = 0, lastTap = 0, lastMove = 0;
  const spread = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  on('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    animation = null;
    dragging = true;
    moved = 0;
    motion = { pose: motion.pose, velocity: { yaw: 0, pitch: 0 } };
    if (pointers.size === 2) pinch = spread();
  });
  on('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) {
      const dt = Math.max(0.008, (e.timeStamp - lastMove) / 1000);
      lastMove = e.timeStamp;
      moved += Math.hypot(dx, dy);
      const pose = clamp({ yaw: motion.pose.yaw + dx * DRAG, pitch: motion.pose.pitch + dy * DRAG });
      const smooth = (old: number, now: number) => old * 0.6 + now * 0.4;
      motion = { pose, velocity: { yaw: smooth(motion.velocity.yaw, (dx * DRAG) / dt), pitch: smooth(motion.velocity.pitch, (dy * DRAG) / dt) } };
    } else if (pointers.size === 2) {
      const now = spread();
      if (pinch) setZoom((zoom * now) / pinch);
      pinch = now;
    }
    invalidate();
  });
  const release = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size === 0) {
      dragging = false;
      if (e.timeStamp - lastMove > 80) motion = { pose: motion.pose, velocity: { yaw: 0, pitch: 0 } };
      if (e.pointerType !== 'mouse' && moved < 8) {
        if (e.timeStamp - lastTap < 320) reset();
        lastTap = e.timeStamp;
      }
      invalidate();
    }
    pinch = pointers.size === 2 ? spread() : 0;
  };
  on('pointerup', release);
  on('pointercancel', release);
  on('dblclick', reset);
  on('wheel', e => {
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  on('keydown', e => {
    const step: Record<string, Pose> = { ArrowLeft: { yaw: -5, pitch: 0 }, ArrowRight: { yaw: 5, pitch: 0 }, ArrowUp: { yaw: 0, pitch: -5 }, ArrowDown: { yaw: 0, pitch: 5 } };
    if (step[e.key]) {
      motion = { pose: clamp({ yaw: motion.pose.yaw + step[e.key].yaw, pitch: motion.pose.pitch + step[e.key].pitch }), velocity: { yaw: 0, pitch: 0 } };
      invalidate();
    } else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.2);
    else if (e.key === '-') setZoom(zoom / 1.2);
    else if (e.key === '0') reset();
    else return;
    e.preventDefault();
  });

  // コンテキストを失って戻った時は、作り直せない映り込みの環境を作り直す
  canvas.addEventListener('webglcontextrestored', () => {
    environments.forEach(t => t.dispose());
    environments.clear();
    pmrem.dispose();
    pmrem = new PMREMGenerator(renderer);
    rigKey = calibrationKey = '';
    applyLook();
    invalidate();
  }, { signal: controller.signal });

  return {
    setImage(w, h, data, paper) {
      paperRgb = paper;
      size = { w, h };
      const next = update(albedo, w, h, data, texelSpace);
      if (next !== albedo) {
        front.map = next;
        front.needsUpdate = true;
      }
      albedo = next;
      applyLook();
      startIntro();
      invalidate();
    },
    setSurface(w, h, data) {
      const next = update(surface, w, h, data, NoColorSpace);
      if (next !== surface) {
        front.roughnessMap = next;
        front.needsUpdate = true;
      }
      surface = next;
      invalidate();
    },
    setLook(next) {
      look = next;
      applyLook();
      invalidate();
    },
    reset,
    async snapshot() {
      frame();
      renderer.render(scene, camera);
      const out = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
      const context = out.getContext('2d')!;
      context.fillStyle = BACKGROUND;
      context.fillRect(0, 0, out.width, out.height);
      context.drawImage(canvas, 0, 0);
      return new Promise<Blob>((resolve, reject) => out.toBlob(b => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
    },
    dispose() {
      cancelAnimationFrame(frameId);
      controller.abort();
      observer.disconnect();
      sheet.geometry.dispose();
      probe.geometry.dispose();
      [front, back, edge, probeMaterial].forEach(m => m.dispose());
      albedo?.dispose();
      surface?.dispose();
      environments.forEach(t => t.dispose());
      probeTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
