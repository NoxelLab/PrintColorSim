<script lang="ts">
  import { untrack } from 'svelte';
  import Compare from './components/Compare.svelte';
  import Field from './components/Field.svelte';
  import Icon from './components/Icon.svelte';
  import { INPUTS, INTENT_CODE, INTENTS, METHODS, PAPERS, PPS, PRESET_NAMES, type ProfileMode, REGIONS, resolve, THRESHOLD, TINTS, USE_DEFAULTS, USES } from './lib/conditions';
  import { displaySpace } from './lib/display';
  import { call, EngineError } from './lib/engine';
  import { download, toPng } from './lib/export';
  import { type Key, t } from './lib/i18n';
  import type { FileInfo, RenderParams, RenderResult } from './lib/protocol';
  import { sample } from './lib/sample';
  import { settings } from './lib/settings.svelte';
  import { loadProfile, saveProfile } from './lib/store';

  const SITE = 'https://noxelwork.com/prtcorsim';
  const SOURCE = 'https://github.com/NoxelLab/PrintColorSim';
  const WARN: [number, number, number] = [0, 229, 255];
  const MAX_PREVIEW = 2048;
  const touch = matchMedia('(pointer: coarse)').matches;

  let file = $state<{ name: string; info: FileInfo } | null>(null);
  let page = $state(0);
  let view = $state.raw<RenderResult | null>(null);
  let picked = $state<{ u: number; v: number; rgb: number[] | null; cmyk: number[] } | null>(null);
  let busy = $state(0);
  let error = $state<Key | null>(null);
  let custom = $state<{ name: string; revision: number } | null>(null);
  let useEmbedded = $state(false);
  let tab = $state<'cond' | 'adv'>('cond');
  let long = $state(0);
  let dropping = $state(false);
  let saved = $state<{ url: string; name: string; file: File } | null>(null);
  let saveDialog = $state<HTMLDialogElement>(), approxDialog = $state<HTMLDialogElement>();
  let fileInput = $state<HTMLInputElement>(), iccInput = $state<HTMLInputElement>();

  const embeddedPrint = $derived(file && file.info.space !== 'rgb' ? file.info.embedded : null);
  const mode = $derived<ProfileMode>(embeddedPrint && useEmbedded ? 'embedded' : settings.custom && custom ? 'custom' : 'preset');
  const resolved = $derived(resolve(settings, mode));
  const profileName = $derived(
    mode === 'embedded' ? embeddedPrint! : mode === 'custom' ? custom!.name
      : PRESET_NAMES[resolved.print] + (resolved.substitute ? `（${t('substitute')}）` : ''),
  );
  const profileOptions = $derived<{ value: ProfileMode; label: string }[]>([
    { value: 'preset', label: t('preset') },
    ...(embeddedPrint ? [{ value: 'embedded' as const, label: `${t('fromFile')}: ${embeddedPrint}` }] : []),
    ...(custom ? [{ value: 'custom' as const, label: `${t('loaded')}: ${custom.name}` }] : []),
  ]);
  /** インテントと黒点補正は RGB 画像を印刷条件へ変換する場合にだけ効く */
  const convertible = $derived(!file || file.info.space === 'rgb');
  const maxLong = $derived(Math.min(MAX_PREVIEW, Math.ceil((long * devicePixelRatio) / 256) * 256));

  const params = $derived.by<RenderParams | null>(() => {
    if (!file || maxLong <= 0) return null;
    void custom?.revision;
    return {
      page, maxLong, display: displaySpace, print: resolved.print, input: settings.input,
      intent: INTENT_CODE[settings.intent], bpc: settings.bpc, chroma: resolved.chroma, lift: resolved.lift,
      paperWhite: settings.paperWhite, tint: resolved.tint, threshold: THRESHOLD, warn: WARN,
    };
  });

  const options = <T extends string>(group: string, values: readonly T[]) => values.map(value => ({ value, label: t(`${group}.${value}` as Key) }));
  const fail = (e: unknown) => {
    if (!(e instanceof EngineError)) console.error(e);
    error = e instanceof EngineError ? e.code : 'failed';
  };

  let rendering = false, queued: RenderParams | null = null;
  async function render(next: RenderParams) {
    queued = next;
    if (rendering) return;
    rendering = true;
    busy++;
    while (queued) {
      const current = queued;
      queued = null;
      try {
        view = await call('render', { params: current });
        if (picked) await pick(picked.u, picked.v);
      } catch (e) {
        fail(e);
      }
    }
    rendering = false;
    busy--;
  }
  $effect(() => {
    const next = params;
    if (next) untrack(() => render(next));
  });
  $effect(() => {
    document.documentElement.lang = settings.lang;
  });

  async function openFile(blob: Blob, name: string) {
    busy++;
    error = null;
    try {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const info = await call('open', { bytes }, [bytes.buffer]);
      view = null;
      picked = null;
      page = 0;
      useEmbedded = true;
      file = { name, info };
    } catch (e) {
      fail(e);
    }
    busy--;
  }

  async function pick(u: number, v: number) {
    const result = await call('pick', { u, v });
    picked = result && { u, v, ...result };
  }

  async function setProfile(bytes: Uint8Array, name: string) {
    const described = await call('profile', { bytes });
    custom = { name: described || name, revision: (custom?.revision ?? 0) + 1 };
  }
  async function loadIcc(icc: File) {
    error = null;
    try {
      const bytes = new Uint8Array(await icc.arrayBuffer());
      await setProfile(bytes, icc.name);
      saveProfile({ name: icc.name, bytes });
      settings.custom = true;
      useEmbedded = false;
    } catch (e) {
      fail(e);
    }
  }
  loadProfile().then(stored => stored && setProfile(stored.bytes, stored.name)).catch(() => {});

  function chooseProfile(value: ProfileMode) {
    useEmbedded = value === 'embedded';
    if (value !== 'embedded') settings.custom = value === 'custom';
  }

  async function save(compare: boolean) {
    if (!params || !file) return;
    busy++;
    try {
      const result = await call('export', { params, compare });
      const blob = await toPng(result, [t('original'), t('printed')]);
      const name = `${file.name.replace(/\.[^.]+$/, '')}-${compare ? 'compare' : 'proof'}.png`;
      if (saved) URL.revokeObjectURL(saved.url);
      saved = { url: URL.createObjectURL(blob), name, file: new File([blob], name, { type: 'image/png' }) };
      // スマホでは作成後に操作を挟まないと保存や共有を開始できないため、ダイアログ内のボタンから保存する
      if (!touch) {
        download(saved.url, name);
        saveDialog?.close();
      }
    } catch (e) {
      fail(e);
      saveDialog?.close();
    }
    busy--;
  }
  function deliver(e: MouseEvent) {
    if (!saved || !navigator.canShare?.({ files: [saved.file] })) return;
    e.preventDefault();
    navigator.share({ files: [saved.file] }).catch(() => {});
  }

  const closeOnBackdrop = (e: MouseEvent) => { if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close(); };
  const pickFile = (e: Event, handler: (f: File) => void) => {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files?.[0]) handler(input.files[0]);
    input.value = '';
  };
  function drop(e: DragEvent) {
    e.preventDefault();
    dropping = false;
    const dropped = e.dataTransfer?.files[0];
    if (dropped) openFile(dropped, dropped.name);
  }
</script>

<svelte:window ondragover={e => { e.preventDefault(); dropping = true; }} ondragleave={() => { dropping = false; }} ondrop={drop} />

<div class="app">
  <header>
    <button class="file" onclick={() => fileInput?.click()}><Icon name="open" /><span>{file?.name ?? t('open')}</span></button>
    {#if file && file.info.pages > 1}
      <div class="pager">
        <button aria-label={t('prevPage')} onclick={() => { page = (page + file!.info.pages - 1) % file!.info.pages; }}><Icon name="prev" /></button>
        <span>{page + 1} / {file.info.pages}</span>
        <button aria-label={t('nextPage')} onclick={() => { page = (page + 1) % file!.info.pages; }}><Icon name="next" /></button>
      </div>
    {/if}
    <span class="gap"></span>
    <button aria-label={t('save')} disabled={!view} onclick={() => { saved = null; saveDialog?.showModal(); }}><Icon name="save" /></button>
    {#if busy}<div class="busy" role="progressbar"></div>{/if}
  </header>

  <Compare {view} warn={settings.warn} pin={picked} bind:long onpick={pick}>
    {#if dropping}
      <p class="drop">{t('drop')}</p>
    {:else if !file && !busy}
      <div class="empty">
        <button class="primary" onclick={() => fileInput?.click()}><Icon name="open" />{t('open')}</button>
        <p>{t('formats')}</p>
        <button class="link" onclick={async () => openFile(await sample(), 'sample.png')}>{t('sample')}</button>
        <p>{t('privacy')}</p>
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
  </Compare>

  <div class="info" aria-label={t('values')}>
    <div>{#each ['R', 'G', 'B'] as channel, i (channel)}<span>{channel}</span><b>{picked?.rgb?.[i] ?? '–'}</b>{/each}</div>
    <div>{#each ['C', 'M', 'Y', 'K'] as channel, i (channel)}<span>{channel}</span><b>{picked?.cmyk[i] ?? '–'}</b>{/each}</div>
  </div>

  <div class="tabs">
    <button class:active={tab === 'cond'} onclick={() => { tab = 'cond'; }}>{t('cond')}</button>
    <button class:active={tab === 'adv'} onclick={() => { tab = 'adv'; }}>{t('adv')}</button>
    <span class="profile">{profileName}</span>
    {#if resolved.approx}<button class="approx" onclick={() => approxDialog?.showModal()}>{t('approx')}</button>{/if}
  </div>

  {#if tab === 'cond'}
    <div class="grid">
      {#if profileOptions.length > 1}
        <Field wide label={t('profile')} value={mode} options={profileOptions} onchange={chooseProfile} />
      {/if}
      <Field label={t('use')} bind:value={settings.use} options={options('use', USES)} disabled={mode !== 'preset'} onchange={use => Object.assign(settings, USE_DEFAULTS[use])} />
      <Field label={t('method')} bind:value={settings.method} options={options('method', METHODS)} disabled={mode !== 'preset'} />
      <Field label={t('paper')} bind:value={settings.paper} options={options('paper', PAPERS)} disabled={mode !== 'preset'} />
      <Field label={t('pp')} bind:value={settings.pp} options={options('pp', PPS)} />
      <Field label={t('region')} bind:value={settings.region} options={options('region', REGIONS)} disabled={mode !== 'preset'} />
      {#if resolved.tint}
        <div class="field">
          <span>{t('tint')}</span>
          <div class="tint">
            {#each Object.entries(TINTS) as [id, color] (id)}
              <button class:active={settings.tint === color} onclick={() => { settings.tint = color; }}>{t(`tint.${id}` as Key)}</button>
            {/each}
            <input type="color" aria-label={t('pickTint')} bind:value={settings.tint} />
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="grid">
      <Field label={t('intent')} bind:value={settings.intent} options={options('intent', INTENTS)} disabled={!convertible} />
      <Field label={t('input')} bind:value={settings.input} options={options('input', INPUTS)} disabled={!convertible || !!file?.info.embedded} />
      <label class="field check" class:disabled={!convertible}><span>{t('bpc')}</span><input type="checkbox" bind:checked={settings.bpc} disabled={!convertible} /></label>
      <label class="field check"><span>{t('paperWhite')}</span><input type="checkbox" bind:checked={settings.paperWhite} /></label>
      <button class="field wide action" onclick={() => iccInput?.click()}>{t('loadIcc')}<Icon name="open" /></button>
    </div>
  {/if}

  <footer>
    <button class="gamut" aria-label={t('showGamut')} aria-pressed={settings.warn} onclick={() => { settings.warn = !settings.warn; }}>
      <Icon name="gamut" />{t('gamut')}<b>{view ? Math.round(view.percent) : '–'}%</b>
    </button>
    <span class="gap"></span>
    <a href="https://x.com/intent/tweet?text={encodeURIComponent(t('shareText'))}&url={encodeURIComponent(SITE)}" target="_blank" rel="noopener">{t('share')}</a>
    <button onclick={() => { settings.lang = settings.lang === 'ja' ? 'en' : 'ja'; }}>{t('otherLang')}</button>
    <a href={SOURCE} target="_blank" rel="noopener">{t('sourceCode')}</a>
  </footer>
  <p class="monitor">{t('monitor')}</p>
</div>

<input type="file" hidden bind:this={fileInput} accept=".png,.jpg,.jpeg,.pdf,.psd,.tif,.tiff,image/png,image/jpeg,image/tiff,application/pdf" onchange={e => pickFile(e, f => openFile(f, f.name))} />
<input type="file" hidden bind:this={iccInput} accept=".icc,.icm" onchange={e => pickFile(e, loadIcc)} />

<dialog bind:this={saveDialog} onclick={closeOnBackdrop}>
  <div>
    {#if saved}
      <a class="row" href={saved.url} download={saved.name} onclick={deliver}>{t('download')}<Icon name="save" /></a>
    {:else if busy}
      <p class="row">{t('preparing')}</p>
    {:else}
      <button class="row" onclick={() => save(false)}>{t('saveProof')}</button>
      <button class="row" onclick={() => save(true)}>{t('saveCompare')}</button>
    {/if}
  </div>
</dialog>

<dialog bind:this={approxDialog} onclick={closeOnBackdrop}>
  <div>
    <p>{t(resolved.substitute ? 'substituteText' : 'approxText')}</p>
    {#if resolved.substitute}
      <a class="row" href="https://japancolor.jp/icc.html" target="_blank" rel="noopener">{t('getJapanColor')}<Icon name="next" /></a>
    {/if}
    <button class="row" onclick={() => { approxDialog?.close(); iccInput?.click(); }}>{t('loadIcc')}<Icon name="open" /></button>
  </div>
</dialog>
