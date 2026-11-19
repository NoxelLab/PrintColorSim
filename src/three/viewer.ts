import {
  BackSide, BoxGeometry, Color, ColorManagement, DataTexture, DirectionalLight, LinearFilter, LinearMipmapLinearFilter,
  LinearSRGBColorSpace, MathUtils, Matrix3, Mesh, MeshLambertMaterial, MeshPhysicalMaterial, type Object3D,
  NeutralToneMapping, NoColorSpace, PerspectiveCamera, PMREMGenerator, PointLight, RectAreaLight, Scene, ShaderMaterial,
  SphereGeometry, SpotLight, SRGBColorSpace, type WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import {
  DisplayP3ColorSpace, DisplayP3ColorSpaceImpl, LinearDisplayP3ColorSpace, LinearDisplayP3ColorSpaceImpl,
} from 'three/addons/math/ColorSpaces.js';
import type { Light } from '../lib/conditions';
import { cast, type Space } from '../lib/lighting';
import { blend, clamp, coast, ease, type Motion, moving, type Pose, REST } from '../lib/rotation';
import type { Finish } from '../lib/surface';

export interface Look {
  light: Light;
  finish: Finish;
  /** 長辺に対する紙の厚さ */
  thickness: number;
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

type EnvKind = 'sky' | 'overcast' | 'room';

interface Rig {
  /** 照明を変えた時の露出。正面向きの紙の白が 2D の再現に近い明るさになるように合わせた値 */
  exposure: number;
  env: EnvKind;
  envIntensity: number;
  lights(color: Color): Object3D[];
}

const RIGS: Record<Light, Rig> = {
  // 左上手前からの太陽と青空。太陽は空の青みと合わせて白が無彩色になる色にする
  sun: {
    exposure: 0.72,
    env: 'sky',
    envIntensity: 0.55,
    lights: color => {
      const sun = new DirectionalLight(color.clone().multiply(new Color(1, 0.97, 0.93)), 3.2);
      sun.position.set(-0.7, 1.5, 1.2);
      return [sun];
    },
  },
  // 空全体からの拡散光だけ
  overcast: { exposure: 1.35, env: 'overcast', envIntensity: 1, lights: () => [] },
  // 手前上方の天井に 2 枚の面光源
  neutral: {
    exposure: 0.85,
    env: 'room',
    envIntensity: 0.45,
    lights: color => [-0.45, 0.45].map(x => {
      const panel = new RectAreaLight(color, 7, 0.5, 1.1);
      panel.position.set(x, 1.15, 1.1);
      panel.lookAt(x, -10, 1.1);
      return panel;
    }),
  },
  // 左上手前からのスポットと、暗い室内
  warm: {
    exposure: 0.85,
    env: 'room',
    envIntensity: 0.12,
    lights: color => {
      const spot = new SpotLight(color, 9, 0, 0.55, 0.7, 2);
      spot.position.set(-0.8, 1.3, 1.4);
      spot.target.position.set(0, 0, 0);
      return [spot, spot.target];
    },
  },
};

let definedSpaces = false;

/** 空の色のグラデーションで映り込みの環境を作る */
function gradientScene(top: Color, horizon: Color, ground: Color) {
  const scene = new Scene();
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { top: { value: top }, horizon: { value: horizon }, ground: { value: ground } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vDir;
      void main() { float y = normalize(vDir).y; vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon, ground, pow(-y, 0.35)); gl_FragColor = vec4(c, 1.0); }`,
  });
  scene.add(new Mesh(new SphereGeometry(10, 48, 24), material));
  return scene;
}

function disposeScene(scene: Scene) {
  scene.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => m.dispose());
  });
}

export function createViewer(canvas: HTMLCanvasElement, space: Space, reducedMotion: boolean): Viewer {
  if (!definedSpaces) {
    ColorManagement.define({ [DisplayP3ColorSpace]: DisplayP3ColorSpaceImpl, [LinearDisplayP3ColorSpace]: LinearDisplayP3ColorSpaceImpl });
    RectAreaLightUniformsLib.init();
    definedSpaces = true;
  }
  const working = space === 'p3' ? LinearDisplayP3ColorSpace : LinearSRGBColorSpace;
  const texelSpace = space === 'p3' ? DisplayP3ColorSpace : SRGBColorSpace;
  ColorManagement.workingColorSpace = working;

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = texelSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(0x000000, 0);
  let pmrem = new PMREMGenerator(renderer);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.01, 50);
  const controller = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}) =>
    canvas.addEventListener(type, fn, { ...options, signal: controller.signal });

  // 色かぶりの行列と色域外の表示は、材質を作り直さずに uniform だけで切り替える
  const uniforms = {
    castMatrix: { value: new Matrix3() },
    warnColor: { value: new Color(WARN) },
    warnOn: { value: 0 },
  };
  const front = new MeshPhysicalMaterial({ roughness: 1, metalness: 0, ior: 1.5 });
  front.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = 'uniform mat3 castMatrix;\nuniform vec3 warnColor;\nuniform float warnOn;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb = castMatrix * diffuseColor.rgb;
      diffuseColor.rgb = mix( diffuseColor.rgb, warnColor, texture2D( roughnessMap, vRoughnessMapUv ).r * warnOn );`,
    );
  };
  const back = new MeshPhysicalMaterial({ metalness: 0, ior: 1.5 });
  const edge = new MeshPhysicalMaterial({ metalness: 0, ior: 1.5 });
  // BoxGeometry の面の順は +x、−x、+y、−y、+z（表）、−z（裏）
  const sheet = new Mesh(new BoxGeometry(1, 1, 0.001), [edge, edge, edge, edge, front, back]);
  sheet.rotation.order = 'YXZ';
  scene.add(sheet);

  let albedo: DataTexture | null = null, surface: DataTexture | null = null;
  let size = { w: 1, h: 1 }, thickness = 0.001, paperRgb: [number, number, number] = [255, 255, 255];
  let look: Look | null = null, rigLights: Object3D[] = [];
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

  function rebuildGeometry() {
    const aspect = size.w / size.h;
    sheet.geometry.dispose();
    sheet.geometry = new BoxGeometry(aspect >= 1 ? 1 : aspect, aspect >= 1 ? 1 / aspect : 1, thickness);
    frame();
  }

  /** 照明の選択に隠れない範囲に、紙全体が収まる距離と位置にカメラを置く */
  function frame() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    camera.aspect = w / h;
    const aspect = size.w / size.h;
    const sheetW = aspect >= 1 ? 1 : aspect, sheetH = aspect >= 1 ? 1 / aspect : 1;
    const reserve = Math.min(0.3, OVERLAY / h);
    const tan = Math.tan(MathUtils.degToRad(camera.fov / 2));
    const fitH = (sheetH * 1.12) / (1 - reserve), fitW = sheetW * 1.12;
    const distance = Math.max(fitH / (2 * tan), fitW / (2 * tan * camera.aspect)) / zoom;
    const shift = reserve * distance * tan;
    camera.position.set(0, -shift, distance);
    camera.lookAt(0, -shift, 0);
    camera.updateProjectionMatrix();
  }

  function environment(kind: EnvKind, color: Color) {
    const key = `${kind}|${color.getHexString()}`;
    let target = environments.get(key);
    if (!target) {
      let envScene: Scene;
      if (kind === 'sky') envScene = gradientScene(new Color(0.42, 0.62, 1).multiply(color), new Color(0.95, 0.96, 0.98).multiply(color), new Color(0.3, 0.28, 0.26));
      else if (kind === 'overcast') envScene = gradientScene(new Color(1, 1, 1).multiply(color), new Color(0.86, 0.86, 0.86).multiply(color), new Color(0.3, 0.3, 0.3));
      else {
        const room = new RoomEnvironment();
        room.traverse(object => {
          const light = object as PointLight;
          if (light.isLight) light.color.multiply(color);
          const material = (object as Mesh).material as MeshLambertMaterial | undefined;
          if (material?.emissive) material.emissive.multiply(color);
        });
        envScene = room;
      }
      target = pmrem.fromScene(envScene, 0.04);
      disposeScene(envScene);
      environments.set(key, target);
    }
    return target.texture;
  }

  function applyLook() {
    if (!look) return;
    const rig = RIGS[look.light];
    const { matrix, color } = cast(look.light, space);
    uniforms.castMatrix.value.set(...matrix);
    uniforms.warnOn.value = look.warn ? 1 : 0;
    const lightColor = new Color().setRGB(color[0], color[1], color[2], working);

    rigLights.forEach(l => scene.remove(l));
    rigLights = rig.lights(lightColor);
    rigLights.forEach(l => scene.add(l));
    scene.environment = environment(rig.env, lightColor);
    scene.environmentIntensity = rig.envIntensity;
    renderer.toneMappingExposure = rig.exposure;

    const f = look.finish;
    Object.assign(front, { clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, specularIntensity: f.specularIntensity });
    Object.assign(back, { roughness: f.paper, clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, specularIntensity: f.specularIntensity });
    Object.assign(edge, { roughness: f.paper, specularIntensity: f.specularIntensity });

    // 裏と縁は紙の色に、表と同じ色かぶりを掛ける
    const paper = new Color().setRGB(paperRgb[0] / 255, paperRgb[1] / 255, paperRgb[2] / 255, texelSpace);
    const [r, g, b] = [paper.r, paper.g, paper.b];
    const m = matrix;
    const tinted = new Color(m[0] * r + m[1] * g + m[2] * b, m[3] * r + m[4] * g + m[5] * b, m[6] * r + m[7] * g + m[8] * b);
    back.color.copy(tinted);
    edge.color.copy(tinted);

    if (Math.abs(look.thickness - thickness) > 1e-9) {
      thickness = look.thickness;
      rebuildGeometry();
    }
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
    applyLook();
    invalidate();
  }, { signal: controller.signal });

  return {
    setImage(w, h, data, paper) {
      paperRgb = paper;
      const resized = w !== size.w || h !== size.h;
      size = { w, h };
      const next = update(albedo, w, h, data, texelSpace);
      if (next !== albedo) {
        front.map = next;
        front.needsUpdate = true;
      }
      albedo = next;
      if (resized) rebuildGeometry();
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
      [front, back, edge].forEach(m => m.dispose());
      albedo?.dispose();
      surface?.dispose();
      environments.forEach(t => t.dispose());
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
