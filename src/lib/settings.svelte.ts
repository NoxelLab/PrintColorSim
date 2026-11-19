import { INPUTS, INTENTS, LIGHTS, METHODS, PAPERS, PPS, REGIONS, type Settings, TINTS, USES } from './conditions';

const KEY = 'prtcorsim';

function load(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** 選択肢のある設定。保存値が選択肢にない場合は既定値を使う */
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  use: USES, method: METHODS, paper: PAPERS, pp: PPS, region: REGIONS, intent: INTENTS, input: INPUTS, light: LIGHTS,
};

const saved = load();
/** 言語はページの URL で決まるため保存しない */
const lang = document.documentElement.lang === 'en' ? 'en' : 'ja';
const defaults: Settings = {
  use: 'poster', method: 'offset', paper: 'coat', pp: 'none', region: lang === 'ja' ? 'jp' : 'eu', tint: TINTS.white,
  intent: 'rel', bpc: true, input: 'srgb', paperWhite: true, warn: false, custom: false, light: 'neutral', lang,
};

export const settings = $state<Settings>({ ...defaults });
for (const key of Object.keys(defaults) as (keyof Settings)[]) {
  const value = saved[key];
  if (key === 'lang' || typeof value !== typeof defaults[key]) continue;
  if (CHOICES[key] && !CHOICES[key].includes(value as string)) continue;
  (settings[key] as unknown) = value;
}

$effect.root(() => {
  $effect(() => {
    const json = JSON.stringify(settings);
    try {
      localStorage.setItem(KEY, json);
    } catch {
      // 保存できない環境では既定値で動作する
    }
  });
});
