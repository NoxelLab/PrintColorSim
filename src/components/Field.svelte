<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    disabled?: boolean;
    wide?: boolean;
    onchange?: (value: T) => void;
  }
  let { label, value = $bindable(), options, disabled = false, wide = false, onchange }: Props = $props();
  const current = $derived(options.find(o => o.value === value)?.label ?? '');
</script>

<label class="field select" class:disabled class:wide>
  <span>{label}</span>
  <b>{current}</b>
  <Icon name="down" />
  <select bind:value {disabled} onchange={() => onchange?.(value)}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</label>
