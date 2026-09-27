<script lang="ts">
  /** 0 none (dots), 1 urgent (alert square), 2-4 high/medium/low (filled bars). */
  let { priority, size = 14 }: { priority: number; size?: number } = $props();
  const filled = $derived(priority === 2 ? 3 : priority === 3 ? 2 : priority === 4 ? 1 : 0);
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 14 14"
  aria-hidden="true"
  class="shrink-0 text-fg-muted"
>
  {#if priority === 1}
    <rect x="1" y="1" width="12" height="12" rx="3" fill="#e5484d" />
    <rect x="6.25" y="3.5" width="1.5" height="4.5" rx=".75" fill="#fff" />
    <rect x="6.25" y="9" width="1.5" height="1.5" rx=".75" fill="#fff" />
  {:else if priority === 0}
    {#each [2, 6, 10] as x (x)}
      <rect {x} y="6.25" width="2" height="1.5" rx=".5" fill="currentColor" opacity=".6" />
    {/each}
  {:else}
    {#each [0, 1, 2] as i (i)}
      <rect
        x={1.5 + i * 4}
        y={9 - i * 3}
        width="3"
        height={3 + i * 3}
        rx=".75"
        fill="currentColor"
        opacity={i < filled ? 1 : 0.25}
      />
    {/each}
  {/if}
</svg>
