<script lang="ts">
  import { LIGHTS } from '../lib/conditions';
  import { displaySpace, sceneSpace } from '../lib/display';
  import { type Key, t } from '../lib/i18n';
  import { p3ToSrgb } from '../lib/lighting';
  import type { RenderResult } from '../lib/protocol';
  import { settings } from '../lib/settings.svelte';
  import { finish, SHEET, surfaceMap } from '../lib/surface';
  import type { Viewer } from '../three/viewer';
  import Choice from './Choice.svelte';

  let { view, onfail }: { view: RenderResult; onfail: () => void } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let viewer = $state.raw<Viewer | null>(null);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lights = $derived(LIGHTS.map(value => ({ value, label: t(`light.${value}` as Key) })));
  const surfaceFinish = $derived(finish(settings.paper, settings.method, settings.pp));

  // 描画器は canvas だけに依存させ、ほかの設定が変わっても作り直さない
  $effect(() => {
    const element = canvas;
    if (!element) return;
    let disposed = false, created: Viewer | null = null;
    import('../three/viewer').then(({ createViewer }) => {
      if (disposed) return;
      try {
        created = createViewer(element, sceneSpace, reducedMotion);
        viewer = created;
      } catch {
        onfail();
      }
    }, () => { if (!disposed) onfail(); });
    return () => {
      disposed = true;
      created?.dispose();
      viewer = null;
    };
  });

  $effect(() => {
    viewer?.setLook({ light: settings.light, finish: surfaceFinish, sheet: SHEET[settings.use], warn: settings.warn });
  });
  $effect(() => {
    viewer?.setImage(view.w, view.h, displaySpace === sceneSpace ? view.right : p3ToSrgb(view.right), view.paper);
  });
  $effect(() => {
    viewer?.setSurface(view.w, view.h, surfaceMap(view.ink, view.mask, surfaceFinish));
  });

  export function snapshot() {
    return viewer ? viewer.snapshot() : Promise.reject(new Error('viewer'));
  }
</script>

<div class="scene">
  <canvas bind:this={canvas} tabindex="0" aria-label={t('sceneLabel')}></canvas>
  <div class="lights">
    <Choice label={t('lighting')} hideLabel bind:value={settings.light} options={lights} />
  </div>
</div>
