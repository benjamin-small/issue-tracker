<script lang="ts">
  import { btn } from '$lib/styles.ts';
  import { page } from '$app/state';
  import Compass from '@lucide/svelte/icons/compass';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import EmptyState from '$components/EmptyState.svelte';
  import { href } from '$lib/nav.ts';

  const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'Not found' : 'Error'} · Issues</title></svelte:head>

<main class="flex min-h-dvh bg-bg-subtle">
  <EmptyState
    icon={missing ? Compass : TriangleAlert}
    tone={missing ? 'neutral' : 'danger'}
    title={missing ? 'This page doesn’t exist' : 'Something went wrong'}
    testid="error-page"
  >
    {#if missing}
      The link may be mistyped, or the page may have moved.
    {:else}
      {page.error?.message ?? 'An unexpected error occurred.'} Reload the page to try again.
    {/if}
    {#snippet actions()}
      <a href={href('/')} class={btn.primary}>Go to your issues</a>
    {/snippet}
  </EmptyState>
</main>
