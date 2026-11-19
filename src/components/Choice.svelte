<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    /** 項目名を画面に出さず、読み上げにだけ使う */
    hideLabel?: boolean;
    value: T;
    options: { value: T; label: string; swatch?: string }[];
    onchange?: (value: T) => void;
    /** 選択肢の後ろに加える枠と、その枠が選ばれているかどうか */
    extra?: Snippet;
    extraActive?: boolean;
  }
  let { label, hideLabel = false, value = $bindable(), options, onchange, extra, extraActive = false }: Props = $props();

  const id = $props.id();
  const found = $derived(options.findIndex(o => o.value === value));
  const index = $derived(found >= 0 ? found : extra && extraActive ? options.length : -1);
  let group = $state<HTMLElement>();

  function select(i: number) {
    const next = options[i].value;
    if (next === value) return;
    value = next;
    onchange?.(next);
  }

  function key(e: KeyboardEvent) {
    const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (Math.max(0, found) + step + options.length) % options.length;
    select(i);
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
  }
</script>

<div class="choice" class:full={hideLabel}>
  {#if !hideLabel}<span {id}>{label}</span>{/if}
  <div
    class="segments"
    class:empty={index < 0}
    role="radiogroup"
    aria-labelledby={hideLabel ? undefined : id}
    aria-label={hideLabel ? label : undefined}
    style:--n={options.length + (extra ? 1 : 0)}
    style:--i={Math.max(0, index)}
    bind:this={group}
  >
    {#each options as option, i (option.value)}
      <button role="radio" aria-checked={i === index} tabindex={i === Math.max(0, found) ? 0 : -1} onclick={() => select(i)} onkeydown={key}>
        {#if option.swatch}<i class="dot" style:background={option.swatch}></i>{/if}{option.label}
      </button>
    {/each}
    {@render extra?.()}
  </div>
</div>
