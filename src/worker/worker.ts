import lcmsWasm from 'lcms-wasm/dist/lcms.wasm?url';
import type { ErrorCode, ExportResult, FileInfo, PickResult, RenderParams, RenderResult, Request, Response } from '../lib/protocol';
import { Cms } from './cms';
import { FileError, loadMupdf, MAX_WORK, open, type Source } from './document';
import { iccSpace } from './icc-extract';
import { proof, type ProofCache, type ProofParams, type Raster } from './proof';

const PROFILE_FILES: Record<string, string> = {
  fogra39: 'ISOcoated_v2_bas.ICC',
  fogra47: 'PSO_Uncoated_ISO12647_bas.ICC',
  gracol: 'GRACoL2013_CRPC6.icc',
  gracolUnc: 'GRACoL2013UNC_CRPC3.icc',
  adobe: 'AdobeCompat-v4.icc',
  p3: 'DisplayP3Compat-v4.icc',
  rec2020: 'Rec2020-v4.icc',
};
/** 比較画像の片側の長辺。2枚を並べても canvas の面積上限に収まる大きさ。 */
const MAX_COMPARE = 2828;
const BAND_PIXELS = 1 << 18;

const scope = self as unknown as { onmessage: ((e: MessageEvent<Request>) => void) | null; postMessage(message: Response, transfer?: Transferable[]): void };
const cmsReady = Cms.create(lcmsWasm);
loadMupdf().catch(() => {});

const icc = new Map<string, Uint8Array>();
let source: Source | null = null;
let revision = 0;
let cache: ProofCache = {};
let last: { orig: Raster; cmyk: Uint8Array } | null = null;

async function ensure(cms: Cms, id: string) {
  if (cms.has(id)) return;
  const response = await fetch(`${import.meta.env.BASE_URL}profiles/${PROFILE_FILES[id]}`);
  if (!response.ok) throw new Error(`profile ${id}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  cms.set(id, bytes);
  icc.set(id, bytes);
}

async function prepare(p: RenderParams) {
  if (!source) throw new Error('no file');
  const cms = await cmsReady;
  const proofParams: ProofParams = {
    ...p,
    source: source.space === 'pdf' ? 'rec2020' : source.embedded ? 'embedded' : source.space === 'cmyk' ? p.print : p.input,
  };
  for (const id of [p.print, p.display, proofParams.source]) await ensure(cms, id);
  const rasters = source.rasters(p.page, p.maxLong, { key: `${p.print}#${revision}`, icc: icc.get(p.print)! });
  return { cms, proofParams, ...rasters };
}

const handlers = {
  async open({ bytes }: { bytes: Uint8Array }): Promise<FileInfo> {
    const cms = await cmsReady;
    await ensure(cms, 'rec2020');
    const opened = await open(bytes, icc.get('rec2020')!);
    const embedded = opened.embedded && cms.set('embedded', opened.embedded);
    if (opened.embedded && !embedded) opened.embedded = null;
    if (opened.embedded) icc.set('embedded', opened.embedded);
    source = opened;
    revision++;
    cache = {};
    last = null;
    return { pages: opened.pages, space: opened.space, embedded: embedded ? embedded.name : null };
  },

  async profile({ bytes }: { bytes: Uint8Array }): Promise<string> {
    const cms = await cmsReady;
    const info = bytes.length >= 128 && iccSpace(bytes) === 'CMYK' ? cms.set('custom', bytes) : null;
    if (!info) throw new FileError('badProfile');
    icc.set('custom', bytes);
    revision++;
    cache = {};
    return info.name;
  },

  async render({ params }: { params: RenderParams }): Promise<[RenderResult, Transferable[]]> {
    const { cms, proofParams, key, orig, sep } = await prepare(params);
    const r = proof(cms, `${revision}|${key}`, orig, sep, proofParams, cache);
    last = { orig, cmyk: r.cmyk };
    const left = r.left.slice(), right = r.right.slice(), mask = r.mask.slice();
    return [{ w: orig.w, h: orig.h, left, right, mask, percent: (r.flagged / (orig.w * orig.h)) * 100 }, [left.buffer, right.buffer, mask.buffer]];
  },

  /** 作業用の解像度で帯ごとに処理し、メモリの使用量を抑える */
  async export({ params, compare }: { params: RenderParams; compare: boolean }): Promise<[ExportResult, Transferable[]]> {
    const { cms, proofParams, orig, sep } = await prepare({ ...params, maxLong: compare ? MAX_COMPARE : MAX_WORK, display: 'srgb' });
    const { w, h, ch } = orig;
    const right = new Uint8ClampedArray(w * h * 4), left = compare ? new Uint8ClampedArray(w * h * 4) : null;
    const rows = Math.max(1, Math.floor(BAND_PIXELS / w));
    for (let y = 0; y < h; y += rows) {
      const from = y * w, to = Math.min(h, y + rows) * w;
      const band: Raster = { w, h: (to - from) / w, ch, data: orig.data.subarray(from * ch, to * ch) };
      const r = proof(cms, '', band, sep && sep.subarray(from * 4, to * 4), proofParams);
      right.set(r.right, from * 4);
      left?.set(r.left, from * 4);
    }
    return [{ w, h, left, right }, left ? [left.buffer, right.buffer] : [right.buffer]];
  },

  async pick({ u, v }: { u: number; v: number }): Promise<PickResult | null> {
    if (!last) return null;
    const { orig, cmyk } = last;
    const i = Math.min(orig.h - 1, Math.floor(v * orig.h)) * orig.w + Math.min(orig.w - 1, Math.floor(u * orig.w));
    return {
      rgb: source?.space === 'rgb' ? [...orig.data.subarray(i * 3, i * 3 + 3)] : null,
      cmyk: [...cmyk.subarray(i * 4, i * 4 + 4)].map(c => Math.round(c / 2.55)),
    };
  },
};

let queue = Promise.resolve();
scope.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const out = await (handlers[data.type] as (payload: unknown) => Promise<unknown>)(data);
      const [result, transfer] = Array.isArray(out) ? out : [out, []];
      scope.postMessage({ id: data.id, ok: true, result }, transfer);
    } catch (e) {
      if (!(e instanceof FileError)) console.error(e);
      const error: ErrorCode = e instanceof FileError ? e.code : 'failed';
      scope.postMessage({ id: data.id, ok: false, error });
    }
  });
};
