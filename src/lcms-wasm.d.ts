declare module 'lcms-wasm' {
  export interface Lcms {
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(ptr: number): void;
    _cmsDoTransform(transform: number, input: number, output: number, pixels: number): void;
    cmsOpenProfileFromMem(bytes: Uint8Array, length: number): number;
    cmsCloseProfile(profile: number): void;
    cmsCreate_sRGBProfile(): number;
    cmsCreateLab4Profile(whitePoint: null): number;
    cmsGetProfileInfoASCII(profile: number, info: number, language: string, country: string): string;
    cmsGetColorSpaceASCII(profile: number): string;
    cmsCreateTransform(input: number, inputFormat: number, output: number, outputFormat: number, intent: number, flags: number): number;
    cmsDeleteTransform(transform: number): void;
  }
  export function instantiate(options?: { locateFile?: (path: string) => string }): Promise<Lcms>;
  export const TYPE_RGB_8: number;
  export const TYPE_CMYK_8: number;
  export const PT_Lab: number;
  export const cmsFLAGS_BLACKPOINTCOMPENSATION: number;
  export function FLOAT_SH(v: number): number;
  export function COLORSPACE_SH(v: number): number;
  export function CHANNELS_SH(v: number): number;
  export function BYTES_SH(v: number): number;
}
