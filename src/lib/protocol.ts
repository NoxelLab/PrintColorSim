export type DisplaySpace = 'srgb' | 'p3';
export type ErrorCode = 'unsupported' | 'tooLarge' | 'password' | 'badProfile' | 'failed';

export interface FileInfo {
  pages: number;
  space: 'rgb' | 'cmyk' | 'pdf';
  /** 埋め込みプロファイルまたは OutputIntent の名前 */
  embedded: string | null;
}

export interface RenderParams {
  page: number;
  /** 描画する画素の長辺の上限 */
  maxLong: number;
  display: DisplaySpace;
  /** 印刷条件のプロファイル ID（内蔵の ID、'embedded'、'custom'） */
  print: string;
  /** 埋め込みのない RGB 画像に割り当てるプロファイル ID */
  input: string;
  intent: number;
  bpc: boolean;
  chroma: number;
  lift: number;
  paperWhite: boolean;
  tint: [number, number, number] | null;
  threshold: number;
  warn: [number, number, number];
}

export interface RenderResult {
  w: number;
  h: number;
  left: Uint8ClampedArray<ArrayBuffer>;
  right: Uint8ClampedArray<ArrayBuffer>;
  mask: Uint8ClampedArray<ArrayBuffer>;
  /** 画素ごとにインキに覆われた面積率（0〜255） */
  ink: Uint8Array<ArrayBuffer>;
  /** 紙の色（表示色空間の 0〜255） */
  paper: [number, number, number];
  /** 色域外の画素の割合（%） */
  percent: number;
}

export interface ExportResult {
  w: number;
  h: number;
  left: Uint8ClampedArray<ArrayBuffer> | null;
  right: Uint8ClampedArray<ArrayBuffer>;
}

export interface PickResult {
  rgb: number[] | null;
  /** 0〜100 の網点率 */
  cmyk: number[];
}

export interface Requests {
  open: { payload: { bytes: Uint8Array }; result: FileInfo };
  profile: { payload: { bytes: Uint8Array }; result: string };
  render: { payload: { params: RenderParams }; result: RenderResult };
  export: { payload: { params: RenderParams; compare: boolean }; result: ExportResult };
  pick: { payload: { u: number; v: number }; result: PickResult | null };
}

export type Request = { [K in keyof Requests]: { id: number; type: K } & Requests[K]['payload'] }[keyof Requests];
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: ErrorCode };
