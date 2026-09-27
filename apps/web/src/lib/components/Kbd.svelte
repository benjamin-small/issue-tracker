<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A keyboard key hint. */
  let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
</script>

<kbd
  class="inline-flex min-w-5 items-center justify-center rounded border border-border bg-bg-subtle px-1 font-sans text-[11px] leading-4 text-fg-subtle {className}"
  >{@render children()}</kbd
>
