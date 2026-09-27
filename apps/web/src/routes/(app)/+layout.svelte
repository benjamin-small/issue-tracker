<script lang="ts">
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { connectLive } from '$lib/live.svelte.ts';
  import { fetchers, keys } from '$lib/queries.ts';
  import { openCreateIssue, ui } from '$lib/ui.svelte.ts';
  import Menu from '@lucide/svelte/icons/menu';
  import Plus from '@lucide/svelte/icons/plus';
  import CreateIssueDialog from '$components/CreateIssueDialog.svelte';
  import CreateProjectDialog from '$components/CreateProjectDialog.svelte';
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

  // Close the navigation drawer whenever the page changes.
  $effect(() => {
    void page.url.href;
    ui.sidebarOpen = false;
  });

  const qc = useQueryClient();
  // One live event stream for the project in view; reconnects when the project changes.
  $effect(() => {
    if (!me.data || !currentProject) return;
    return connectLive(qc, currentProject);
  });

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
  <div class="flex h-dvh overflow-hidden">
    <Sidebar me={me.data} projects={projects.data ?? []} {currentProject} />
    {#if ui.sidebarOpen}
      <button
        class="fixed inset-0 z-30 bg-black/30 md:hidden"
        aria-label="Close menu"
        onclick={() => (ui.sidebarOpen = false)}
      ></button>
    {/if}
    <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Narrow screens: the sidebar becomes a drawer opened from this bar. -->
      <div class="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
        <button
          class="rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
          aria-label="Open menu"
          aria-expanded={ui.sidebarOpen}
          data-testid="open-menu"
          onclick={() => (ui.sidebarOpen = true)}><Menu size={18} /></button
        >
        <span class="truncate text-sm font-medium"
          >{projects.data?.find((p) => p.key === currentProject)?.name ?? 'Tracker'}</span
        >
        {#if currentProject}
          <button
            class="ml-auto rounded-md p-1.5 text-fg-muted hover:bg-bg-hover hover:text-fg"
            aria-label="New issue"
            onclick={() => openCreateIssue(currentProject)}><Plus size={18} /></button
          >
        {/if}
      </div>
      {@render children()}
    </main>
  </div>
  {#if ui.createIssue.open}<CreateIssueDialog />{/if}
  {#if ui.createProject}<CreateProjectDialog />{/if}
{:else if me.isError}
  <div class="p-8 text-sm text-fg-muted">Redirecting to sign in…</div>
{:else}
  <div class="p-8 text-sm text-fg-subtle">Loading…</div>
{/if}
