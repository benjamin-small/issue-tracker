<script lang="ts">
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { fetchers, keys } from '$lib/queries.ts';
  import { openCreateIssue, ui } from '$lib/ui.svelte.ts';
  import CreateIssueDialog from '$components/CreateIssueDialog.svelte';
  import Sidebar from '$components/Sidebar.svelte';

  let { children } = $props();

  const me = createQuery(() => ({ queryKey: keys.me, queryFn: fetchers.me, staleTime: 300_000 }));
  const projects = createQuery(() => ({ queryKey: keys.projects, queryFn: fetchers.projects }));

  /** Current project from the URL (`/p/ENG…` or `/i/ENG-42`), else the first project. */
  const currentProject = $derived(
    (page.params.key && /^[A-Za-z][A-Za-z0-9]*$/.test(page.params.key)
      ? page.params.key.toUpperCase()
      : undefined) ??
      page.params.issueKey?.split('-')[0]?.toUpperCase() ??
      projects.data?.[0]?.key ??
      '',
  );

  function onkeydown(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))
      return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'c' && currentProject && !ui.createIssue.open) {
      event.preventDefault();
      openCreateIssue(currentProject);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if me.data}
  <div class="flex h-screen overflow-hidden">
    <Sidebar me={me.data} projects={projects.data ?? []} {currentProject} />
    <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
      {@render children()}
    </main>
  </div>
  {#if ui.createIssue.open}<CreateIssueDialog />{/if}
{:else if me.isError}
  <div class="p-8 text-sm text-fg-muted">Redirecting to sign in…</div>
{:else}
  <div class="p-8 text-sm text-fg-subtle">Loading…</div>
{/if}
