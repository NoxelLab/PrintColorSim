<script lang="ts" generics="T extends string">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    value?: T;
    options?: { value: T; label: string }[];
    disabled?: boolean;
    onchange?: (value: T) => void;
    /** 選択肢の右に並べる要素 */
    children?: Snippet;
  }
  let { label, value = $bindable(), options = [], disabled = false, onchange, children }: Props = $props();
  const id = $props.id();
</script>

<div class="choice" class:disabled>
  <span {id}>{label}</span>
  <div class="segments" role="radiogroup" aria-labelledby={id}>
    {#each options as option (option.value)}
      <button
        role="radio"
        aria-checked={value === option.value}
        class:active={value === option.value}
        {disabled}
        onclick={() => { value = option.value; onchange?.(option.value); }}
      >{option.label}</button>
    {/each}
    {@render children?.()}
  </div>
</div>
