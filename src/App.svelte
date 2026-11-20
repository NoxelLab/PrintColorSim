<script lang="ts">
  import { untrack } from 'svelte';
  import Choice from './components/Choice.svelte';
  import Compare from './components/Compare.svelte';
  import Field from './components/Field.svelte';
  import Icon from './components/Icon.svelte';
  import Scene from './components/Scene.svelte';
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
  /** 言語ごとのページ。言語は URL で決まる */
  const PAGES = { ja: import.meta.env.BASE_URL.slice(0, -1), en: `${import.meta.env.BASE_URL}en` };
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
  let saveDialog = $state<HTMLDialogElement>();
  /** 立体表示 */
  let solid = $state(false);
  let scene = $state<ReturnType<typeof Scene>>();
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
    ...(embeddedPrint ? [{ value: 'embedded' as const, label: t('fromFile') }] : []),
    ...(custom ? [{ value: 'custom' as const, label: t('loaded') }] : []),
  ]);
  const tintOptions = $derived(Object.entries(TINTS).map(([id, color]) => ({ value: color as string, label: t(`tint.${id}` as Key), swatch: color })));
  const customTint = $derived(!(Object.values(TINTS) as string[]).includes(settings.tint));
  /** インテントと黒点補正は RGB 画像を印刷条件へ変換する場合にだけ効く */
  const convertible = $derived(!file || file.info.space === 'rgb');
  const maxLong = $derived(Math.min(MAX_PREVIEW, Math.ceil((long * devicePixelRatio) / 256) * 256));

  const params = $derived.by<RenderParams | null>(() => {
    if (!file || maxLong <= 0) return null;
    void custom?.revision;
    return {
      page, maxLong, display: displaySpace, print: resolved.print, input: settings.input,
      intent: INTENT_CODE[settings.intent], bpc: settings.bpc, film: resolved.film,
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

  /** スマホでは作成後に操作を挟まないと保存や共有を開始できないため、ダイアログ内のボタンから保存する */
  function keep(blob: Blob, suffix: string) {
    const name = `${file!.name.replace(/\.[^.]+$/, '')}-${suffix}.png`;
    if (saved) URL.revokeObjectURL(saved.url);
    saved = { url: URL.createObjectURL(blob), name, file: new File([blob], name, { type: 'image/png' }) };
    if (!touch) {
      download(saved.url, name);
      saveDialog?.close();
    }
  }
  async function save(kind: 'proof' | 'compare' | '3d') {
    if (!params || !file) return;
    busy++;
    try {
      const blob = kind === '3d' ? await scene!.snapshot() : await toPng(await call('export', { params, compare: kind === 'compare' }), [t('original'), t('printed')]);
      keep(blob, kind);
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
  <div class="tool">
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
      {#if view}
        <div class="view-switch">
          <Choice label={t('view')} hideLabel value={solid ? 'solid' : 'compare'} options={[{ value: 'compare', label: t('compare') }, { value: 'solid', label: t('solid') }]} onchange={v => { solid = v === 'solid'; }} />
        </div>
      {/if}
      <button aria-label={t('save')} disabled={!view} onclick={() => { saved = null; saveDialog?.showModal(); }}><Icon name="save" /></button>
      {#if busy}<div class="busy" role="progressbar"></div>{/if}
    </header>

    <Compare {view} active={!solid} warn={settings.warn} pin={picked} bind:long onpick={pick}>
      {#if solid && view}
        <Scene bind:this={scene} {view} onfail={() => { solid = false; error = 'webgl'; }} />
      {/if}
      {#if dropping}
        <p class="drop">{t('drop')}</p>
      {:else if !file && !busy}
        <div class="empty">
          <p class="lead">{t('lead')}</p>
          <button class="primary" onclick={() => fileInput?.click()}><Icon name="open" />{t('open')}</button>
          <p>{t('formats')}</p>
          <button class="link" onclick={async () => openFile(await sample(), 'sample.png')}>{t('sample')}</button>
          <p>{t('privacy')}</p>
        </div>
      {/if}
      {#if error}<p class="error" role="alert">{t(error)}</p>{/if}
    </Compare>

    <div class="info" aria-label={t('values')}>
      <div>{#each ['R', 'G', 'B'] as channel, i (channel)}<span><i>{channel}</i><b>{picked?.rgb?.[i] ?? '–'}</b></span>{/each}</div>
      <div>{#each ['C', 'M', 'Y', 'K'] as channel, i (channel)}<span><i>{channel}</i><b>{picked?.cmyk[i] ?? '–'}</b></span>{/each}</div>
    </div>

    <div class="tabs">
      <div class="tablist" role="tablist">
        <button role="tab" id="tab-cond" aria-controls="pane-cond" aria-selected={tab === 'cond'} onclick={() => { tab = 'cond'; }}>{t('cond')}</button>
        <button role="tab" id="tab-adv" aria-controls="pane-adv" aria-selected={tab === 'adv'} onclick={() => { tab = 'adv'; }}>{t('adv')}</button>
      </div>
      <span class="profile">{profileName}</span>
    </div>

    {#snippet customTintSegment()}
      <label class:active={customTint}>
        <i class="dot" class:any={!customTint} style:background={customTint ? settings.tint : null}></i>{t('customTint')}
        <input type="color" aria-label={t('pickTint')} bind:value={settings.tint} />
      </label>
    {/snippet}

    <!-- 2つのタブを重ねて置き、切り替えても画像の大きさが変わらないようにする -->
    <div class="panel">
      <div class="pane" role="tabpanel" id="pane-cond" aria-labelledby="tab-cond" class:off={tab !== 'cond'} inert={tab !== 'cond'}>
        {#if profileOptions.length > 1}
          <Choice label={t('profile')} hideLabel value={mode} options={profileOptions} onchange={chooseProfile} />
        {/if}
        {#if mode === 'preset'}
          <Choice label={t('use')} bind:value={settings.use} options={options('use', USES)} onchange={use => Object.assign(settings, USE_DEFAULTS[use])} />
        {/if}
        <!-- ファイルの指定や読み込んだ ICC を使う間も、立体表示ではつやを決めるために表示する -->
        {#if mode === 'preset' || solid}
          <Choice label={t('method')} bind:value={settings.method} options={options('method', METHODS)} />
          <Choice label={t('paper')} bind:value={settings.paper} options={options('paper', PAPERS)} />
        {/if}
        {#if mode === 'preset' && settings.paper === 'special'}
          <Choice label={t('tint')} bind:value={settings.tint} options={tintOptions} extra={customTintSegment} extraActive={customTint} />
        {/if}
        <Choice label={t('pp')} bind:value={settings.pp} options={options('pp', PPS)} />
        {#if mode === 'preset'}
          <Choice label={t('region')} bind:value={settings.region} options={options('region', REGIONS)} />
        {/if}
      </div>
      <div class="pane" role="tabpanel" id="pane-adv" aria-labelledby="tab-adv" class:off={tab !== 'adv'} inert={tab !== 'adv'}>
        {#if convertible}
          <Choice label={t('intent')} bind:value={settings.intent} options={options('intent', INTENTS)} />
          {#if !file?.info.embedded}
            <Field label={t('input')} bind:value={settings.input} options={options('input', INPUTS)} />
          {/if}
          <label class="switch"><span>{t('bpc')}</span><input type="checkbox" role="switch" bind:checked={settings.bpc} /></label>
        {/if}
        <label class="switch"><span>{t('paperWhite')}</span><input type="checkbox" role="switch" bind:checked={settings.paperWhite} /></label>
        <button class="action" onclick={() => iccInput?.click()}>{t('loadIcc')}<Icon name="open" /></button>
      </div>
    </div>

    <footer>
      <button class="gamut" aria-label={t('showGamut')} aria-pressed={settings.warn} onclick={() => { settings.warn = !settings.warn; }}>
        <Icon name="gamut" />{t('gamut')}<b>{view ? Math.round(view.percent) : '–'}%</b>
      </button>
      <span class="gap"></span>
      <a href="https://x.com/intent/tweet?text={encodeURIComponent(t('shareText'))}&url={encodeURIComponent(SITE)}" target="_blank" rel="noopener">{t('share')}</a>
      {#if settings.lang === 'ja'}
        <a href={PAGES.en} hreflang="en" lang="en">English</a>
      {:else}
        <a href={PAGES.ja} hreflang="ja" lang="ja">日本語</a>
      {/if}
      <a href={SOURCE} target="_blank" rel="noopener">{t('sourceCode')}</a>
    </footer>
    <p class="monitor">{t('monitor')}</p>
  </div>

  {#if resolved.approx || solid}
    <div class="note" role="note">
      <div class="callout">
        {#if solid}<p><Icon name="alert" />{t('solidText')}</p>{/if}
        {#if resolved.approx}
          <p><Icon name="alert" />{t(resolved.substitute ? 'substituteText' : 'approxText')}</p>
          {#if resolved.substitute}
            <a class="row" href="https://japancolor.jp/icc.html" target="_blank" rel="noopener">{t('getJapanColor')}<Icon name="next" /></a>
          {/if}
          <button class="row" onclick={() => iccInput?.click()}>{t('loadIcc')}<Icon name="open" /></button>
        {/if}
      </div>
    </div>
  {/if}
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
      {#if solid}<button class="row" onclick={() => save('3d')}>{t('save3d')}</button>{/if}
      <button class="row" onclick={() => save('proof')}>{t('saveProof')}</button>
      <button class="row" onclick={() => save('compare')}>{t('saveCompare')}</button>
    {/if}
  </div>
</dialog>
