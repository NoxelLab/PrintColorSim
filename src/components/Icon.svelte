<script lang="ts" module>
  const PATHS = {
    open: 'M3 6h6l2 2h10v11H3z',
    save: 'M12 4v11m-5-5 5 5 5-5M5 20h14',
    prev: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7',
    down: 'M5 9l7 7 7-7',
    gamut: 'M4 4h16v16H4zM4 12l8-8M4 20L20 4M12 20l8-8',
    alert: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7.5v5.5M12 16.5v.01',
  };
  export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
  let { name }: { name: IconName } = $props();
</script>

<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={PATHS[name]} /></svg>
