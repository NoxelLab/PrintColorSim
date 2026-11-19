import { type Settings, TINTS } from './conditions';

const KEY = 'prtcorsim';

function load(): Partial<Settings> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const saved = load();
const lang = saved.lang ?? (navigator.language.startsWith('ja') ? 'ja' : 'en');
const defaults: Settings = {
  use: 'poster', method: 'offset', paper: 'coat', pp: 'none', region: lang === 'ja' ? 'jp' : 'eu', tint: TINTS.kraft,
  intent: 'rel', bpc: true, input: 'srgb', paperWhite: true, warn: false, custom: false, lang,
};

export const settings = $state<Settings>({ ...defaults });
for (const key of Object.keys(defaults) as (keyof Settings)[]) {
  if (typeof saved[key] === typeof defaults[key]) (settings[key] as unknown) = saved[key];
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
