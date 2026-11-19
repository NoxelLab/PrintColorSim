export const USES = ['card', 'poster', 'flyer', 'book'] as const;
export const METHODS = ['offset', 'ondemand', 'inkjet'] as const;
export const PAPERS = ['coat', 'matte', 'plain', 'special'] as const;
export const PPS = ['none', 'gloss', 'mattepp'] as const;
export const REGIONS = ['jp', 'eu', 'us'] as const;
export const INTENTS = ['perc', 'rel', 'sat', 'abs'] as const;
export const INPUTS = ['srgb', 'adobe', 'p3'] as const;
export const LIGHTS = ['sun', 'overcast', 'neutral', 'warm'] as const;
/** 特殊紙の紙色。白は内蔵の上質紙プロファイル（FOGRA47）の紙白 */
export const TINTS = { white: '#eff1f4', ecru: '#efe7d3', kraft: '#c8a67a' } as const;

export type Use = (typeof USES)[number];
export type Method = (typeof METHODS)[number];
export type Paper = (typeof PAPERS)[number];
export type Pp = (typeof PPS)[number];
export type Region = (typeof REGIONS)[number];
export type Intent = (typeof INTENTS)[number];
export type Input = (typeof INPUTS)[number];
export type Light = (typeof LIGHTS)[number];
export type Lang = 'ja' | 'en';
/** 印刷プロファイルの出どころ：内蔵プリセット、ファイルの指定、読み込んだ ICC */
export type ProfileMode = 'preset' | 'embedded' | 'custom';

export interface Settings {
  use: Use;
  method: Method;
  paper: Paper;
  pp: Pp;
  region: Region;
  tint: string;
  intent: Intent;
  bpc: boolean;
  input: Input;
  paperWhite: boolean;
  warn: boolean;
  /** 立体表示の照明 */
  light: Light;
  /** 読み込んだ ICC を印刷条件として使う */
  custom: boolean;
  lang: Lang;
}

export const USE_DEFAULTS: Record<Use, { method: Method; paper: Paper }> = {
  card: { method: 'ondemand', paper: 'matte' },
  poster: { method: 'offset', paper: 'coat' },
  flyer: { method: 'offset', paper: 'coat' },
  book: { method: 'offset', paper: 'plain' },
};

/** Little CMS のレンダリングインテントの番号 */
export const INTENT_CODE: Record<Intent, number> = { perc: 0, rel: 1, sat: 2, abs: 3 };

/** 色域外と判定する ΔE2000 の閾値 */
export const THRESHOLD = 5;

/** 標準プロファイルのない条件に加える近似補正。標準データに基づかない独自の設定値。 */
const ADJUST: Record<string, { chroma: number; lift: number }> = {
  matte: { chroma: 0.96, lift: 2 },
  special: { chroma: 0.95, lift: 1 },
  ondemand: { chroma: 0.97, lift: 1 },
  inkjet: { chroma: 1.03, lift: -1 },
  gloss: { chroma: 1.04, lift: -2 },
  mattepp: { chroma: 0.94, lift: 3 },
};

export interface Resolved {
  /** 印刷条件のプロファイル ID */
  print: string;
  chroma: number;
  lift: number;
  tint: [number, number, number] | null;
  /** 標準データに基づかない目安の表示 */
  approx: boolean;
  /** 日本の基準を近い条件のプロファイルで代用している */
  substitute: boolean;
}

export const hexToRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

export function resolve(s: Settings, mode: ProfileMode): Resolved {
  const preset = mode === 'preset';
  const factors = preset ? [s.method, s.paper, s.pp] : [s.pp];
  let chroma = 1, lift = 0;
  for (const f of factors) {
    chroma *= ADJUST[f]?.chroma ?? 1;
    lift += ADJUST[f]?.lift ?? 0;
  }
  const coated = s.paper === 'coat' || s.paper === 'matte';
  const substitute = preset && s.region === 'jp';
  return {
    print: !preset ? mode : s.region === 'us' ? (coated ? 'gracol' : 'gracolUnc') : coated ? 'fogra39' : 'fogra47',
    chroma,
    lift,
    tint: preset && s.paper === 'special' ? hexToRgb(s.tint) : null,
    approx: substitute || factors.some(f => f in ADJUST),
    substitute,
  };
}

/** 内蔵プリセットの表示名 */
export const PRESET_NAMES: Record<string, string> = {
  fogra39: 'FOGRA39',
  fogra47: 'FOGRA47',
  gracol: 'GRACoL 2013',
  gracolUnc: 'GRACoL 2013 UNC',
};
