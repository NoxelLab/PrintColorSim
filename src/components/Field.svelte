<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte';

  interface Props {
    label: string;
    value: T;
    options: { value: T; label: string }[];
  }
  let { label, value = $bindable(), options }: Props = $props();

  const id = $props.id();
  const current = $derived(options.find(o => o.value === value)?.label ?? '');
</script>

<div class="choice">
  <span {id}>{label}</span>
  <label class="dropdown">
    <b>{current}</b>
    <Icon name="down" />
    <select bind:value aria-labelledby={id}>
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </label>
</div>
