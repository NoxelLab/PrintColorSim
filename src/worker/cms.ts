import * as L from 'lcms-wasm';

export const RGB8 = L.TYPE_RGB_8;
export const CMYK8 = L.TYPE_CMYK_8;
export const LABF = L.FLOAT_SH(1) | L.COLORSPACE_SH(L.PT_Lab) | L.CHANNELS_SH(3) | L.BYTES_SH(4);
export const BPC = L.cmsFLAGS_BLACKPOINTCOMPENSATION;
export const PERCEPTUAL = 0, RELATIVE = 1, SATURATION = 2, ABSOLUTE = 3;

const BYTES: Record<number, number> = { [RGB8]: 3, [CMYK8]: 4, [LABF]: 12 };
const CHUNK = 1 << 16;

export interface ProfileInfo { name: string; space: string }

/** Little CMS の薄いラッパー。プロファイルは ID で管理し、変換は初回に生成して使い回す。 */
export class Cms {
  #lcms: L.Lcms;
  #profiles = new Map<string, number>();
  #transforms = new Map<string, number>();
  #in: number;
  #out: number;

  static async create(wasmUrl?: string) {
    return new Cms(await L.instantiate(wasmUrl ? { locateFile: () => wasmUrl } : undefined));
  }

  private constructor(lcms: L.Lcms) {
    this.#lcms = lcms;
    this.#profiles.set('srgb', lcms.cmsCreate_sRGBProfile());
    this.#profiles.set('lab', lcms.cmsCreateLab4Profile(null));
    this.#in = lcms._malloc(CHUNK * 12);
    this.#out = lcms._malloc(CHUNK * 12);
  }

  has(id: string) {
    return this.#profiles.has(id);
  }

  /** 同じ ID のプロファイルがあれば置き換える。ICC として開けない場合は null を返す。 */
  set(id: string, bytes: Uint8Array): ProfileInfo | null {
    const handle = this.#lcms.cmsOpenProfileFromMem(bytes, bytes.length);
    if (!handle) return null;
    const old = this.#profiles.get(id);
    if (old) {
      for (const [key, transform] of this.#transforms) {
        if (key.split('|').includes(id)) {
          this.#lcms.cmsDeleteTransform(transform);
          this.#transforms.delete(key);
        }
      }
      this.#lcms.cmsCloseProfile(old);
    }
    this.#profiles.set(id, handle);
    return {
      name: this.#lcms.cmsGetProfileInfoASCII(handle, 0, 'en', 'US'),
      space: this.#lcms.cmsGetColorSpaceASCII(handle).trim(),
    };
  }

  run(src: Uint8Array | Float32Array, from: string, fromFormat: number, to: string, toFormat: number, intent: number, flags = 0) {
    const key = [from, fromFormat, to, toFormat, intent, flags].join('|');
    let transform = this.#transforms.get(key);
    if (!transform) {
      transform = this.#lcms.cmsCreateTransform(this.#profiles.get(from)!, fromFormat, this.#profiles.get(to)!, toFormat, intent, flags);
      if (!transform) throw new Error(`transform ${key}`);
      this.#transforms.set(key, transform);
    }
    const inBytes = BYTES[fromFormat], outBytes = BYTES[toFormat];
    const input = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    const pixels = input.length / inBytes;
    const output = new Uint8Array(pixels * outBytes);
    for (let p = 0; p < pixels; p += CHUNK) {
      const n = Math.min(CHUNK, pixels - p);
      this.#lcms.HEAPU8.set(input.subarray(p * inBytes, (p + n) * inBytes), this.#in);
      this.#lcms._cmsDoTransform(transform, this.#in, this.#out, n);
      output.set(this.#lcms.HEAPU8.subarray(this.#out, this.#out + n * outBytes), p * outBytes);
    }
    return toFormat === LABF ? new Float32Array(output.buffer) : output;
  }
}
