<script lang="ts">
  import type { Snippet } from 'svelte';
  import { displaySpace, paint } from '../lib/display';
  import { t } from '../lib/i18n';
  import type { RenderResult } from '../lib/protocol';

  interface Props {
    view: RenderResult | null;
    warn: boolean;
    pin: { u: number; v: number } | null;
    /** 表示領域の長辺（CSS ピクセル） */
    long: number;
    onpick: (u: number, v: number) => void;
    children?: Snippet;
  }
  let { view, warn, pin, long = $bindable(), onpick, children }: Props = $props();

  const PADDING = 16;
  let boxWidth = $state(0), boxHeight = $state(0), split = $state(50);
  let root = $state<HTMLElement>(), left = $state<HTMLCanvasElement>(), right = $state<HTMLCanvasElement>(), mask = $state<HTMLCanvasElement>();

  const width = $derived(view ? Math.max(0, Math.min(boxWidth - PADDING, ((boxHeight - PADDING) * view.w) / view.h)) : 0);

  $effect(() => {
    long = Math.max(boxWidth, boxHeight) - PADDING;
  });
  $effect(() => {
    if (!view || !left || !right || !mask) return;
    paint(left, view.left, view.w, view.h, displaySpace);
    paint(right, view.right, view.w, view.h, displaySpace);
    paint(mask, view.mask, view.w, view.h, displaySpace);
  });

  const position = (e: MouseEvent) => {
    const box = root!.getBoundingClientRect();
    return { u: (e.clientX - box.left) / box.width, v: (e.clientY - box.top) / box.height };
  };
  const clamp = (value: number) => Math.max(0, Math.min(100, value));

  function drag(e: PointerEvent) {
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    handle.onpointermove = move => { split = clamp(position(move).u * 100); };
    handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; };
    e.preventDefault();
  }
  function key(e: KeyboardEvent) {
    const step = e.key === 'ArrowLeft' ? -2 : e.key === 'ArrowRight' ? 2 : 0;
    if (!step) return;
    split = clamp(split + step);
    e.preventDefault();
  }
  function pick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.handle')) return;
    const { u, v } = position(e);
    onpick(u, v);
  }
</script>

<main bind:clientWidth={boxWidth} bind:clientHeight={boxHeight}>
  {#if view}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="compare" class:warn bind:this={root} style:width="{width}px" style:height="{(width * view.h) / view.w}px" style:--x="{split}%" onclick={pick}>
      <canvas bind:this={left}></canvas>
      <div class="printed">
        <canvas bind:this={right}></canvas>
        <canvas class="mask" bind:this={mask}></canvas>
      </div>
      <span class="side" style:left="8px" style:opacity={split < 14 ? 0 : 1}>{t('original')}</span>
      <span class="side" style:right="8px" style:opacity={split > 86 ? 0 : 1}>{t('printed')}</span>
      {#if pin}<div class="pin" style:left="{pin.u * 100}%" style:top="{pin.v * 100}%"></div>{/if}
      <div class="handle" role="slider" tabindex="0" aria-label={t('divider')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(split)} onpointerdown={drag} onkeydown={key}><i></i></div>
    </div>
  {/if}
  {@render children?.()}
</main>
