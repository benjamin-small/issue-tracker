<script lang="ts">
  import { goto } from '$app/navigation';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchers, keys } from '$lib/queries.ts';

  const projects = createQuery(() => ({ queryKey: keys.projects, queryFn: fetchers.projects }));
  $effect(() => {
    const first = projects.data?.[0];
    if (first) void goto(`/p/${first.key}`, { replaceState: true });
  });
</script>

{#if projects.data && projects.data.length === 0}
  <div class="m-auto max-w-md p-8 text-center">
    <h1 class="mb-2 text-lg font-semibold">No projects yet</h1>
    <p class="text-sm text-fg-muted">
      An admin can create one with <code class="font-mono"
        >tracker project create --key ENG --name Engineering</code
      >.
    </p>
  </div>
{/if}
