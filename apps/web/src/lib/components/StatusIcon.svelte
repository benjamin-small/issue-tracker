<script lang="ts">
  /** Status glyph by category: dashed (backlog), empty (unstarted), half (started), check (completed), cross (canceled). */
  let { category, color, size = 14 }: { category: string; color: string; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 14 14"
  fill="none"
  aria-hidden="true"
  class="shrink-0"
  style:color
>
  {#if category === 'backlog'}
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2" />
  {:else if category === 'unstarted'}
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" />
  {:else if category === 'started'}
    <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.5" />
    <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
  {:else if category === 'completed'}
    <circle cx="7" cy="7" r="6.25" fill="currentColor" />
    <path
      d="M4.5 7.2 6.2 8.9 9.6 5.3"
      stroke="var(--color-bg)"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {:else}
    <circle cx="7" cy="7" r="6.25" fill="currentColor" />
    <path d="m5 5 4 4m0-4-4 4" stroke="var(--color-bg)" stroke-width="1.5" stroke-linecap="round" />
  {/if}
</svg>
