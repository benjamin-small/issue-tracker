<script lang="ts">
  import { btn } from '$lib/styles.ts';
  import { navigate } from '$lib/nav.ts';
  import { createQuery } from '@tanstack/svelte-query';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import { fetchers, keys } from '$lib/queries.ts';
  import { ui } from '$lib/ui.svelte.ts';

  const me = createQuery(() => ({ queryKey: keys.me, queryFn: fetchers.me, staleTime: 300_000 }));
  const projects = createQuery(() => ({ queryKey: keys.projects, queryFn: fetchers.projects }));
  $effect(() => {
    const first = projects.data?.[0];
    if (first) void navigate(`/p/${first.key}`, { replaceState: true });
  });
</script>

{#if projects.data && projects.data.length === 0}
  <div class="m-auto max-w-sm p-8 text-center" data-testid="no-projects">
    <div
      class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-accent-subtle text-accent"
    >
      <FolderPlus size={22} />
    </div>
    <h1 class="mb-1 text-lg font-semibold">Create your first project</h1>
    <p class="mb-5 text-sm text-fg-muted">
      Projects hold issues, a workflow and a board. Most teams start with one per product or team.
    </p>
    {#if me.data?.role === 'admin'}
      <button class={btn.primary} onclick={() => (ui.createProject = true)}>New project</button>
    {:else}
      <p class="text-sm text-fg-subtle">
        Ask an admin to create a project and it will appear here.
      </p>
    {/if}
  </div>
{/if}
