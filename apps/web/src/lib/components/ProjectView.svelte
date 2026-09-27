<script lang="ts">
  import { page } from '$app/state';
  import { current, navigate, pushPageState } from '$lib/nav.ts';
  import { createQuery } from '@tanstack/svelte-query';
  import type { View } from '../api.ts';
  import { useProjectData } from '../project-data.svelte.ts';
  import { fetchers, keys } from '../queries.ts';
  import {
    decodeConfig,
    defaultViewConfig,
    encodeConfig,
    migrateViewConfig,
    sameConfig,
    type ViewConfig,
  } from '../views.ts';
  import Board from './Board.svelte';
  import FilterBar from './FilterBar.svelte';
  import IssueDetail from './IssueDetail.svelte';
  import IssueList from './IssueList.svelte';
  import ViewConfigPanel from './ViewConfigPanel.svelte';
  import ViewMenu from './ViewMenu.svelte';

  /**
   * A project's issues through a view: the saved view's config, overridden by an unsaved `?v=` config in the URL
   * (shareable). Renders the list or the board, with the issue peek panel on the side.
   */
  let {
    projectKey,
    layout,
    viewId,
  }: { projectKey: string; layout: 'list' | 'board'; viewId?: string } = $props();

  const project = useProjectData(() => projectKey);
  const view = $derived<View | undefined>(
    viewId
      ? project.views.find((v) => v.id === viewId)
      : (project.views.find((v) => v.layout === layout && v.ownerId === null) ??
          project.views.find((v) => v.layout === layout)),
  );
  const saved = $derived<ViewConfig>(
    view ? migrateViewConfig(view.config) : defaultViewConfig(layout),
  );
  const config = $derived<ViewConfig>(decodeConfig(current().params.get('v')) ?? saved);
  const effectiveLayout = $derived(view?.layout ?? layout);
  const dirty = $derived(!sameConfig(config, saved));

  function setConfig(next: ViewConfig) {
    const { path, params } = current();
    if (sameConfig(next, saved)) params.delete('v');
    else params.set('v', encodeConfig(next));
    const query = params.toString();
    void navigate(query ? `${path}?${query}` : path, {
      replaceState: true,
      keepFocus: true,
      noScroll: true,
    });
  }

  const listQuery = $derived({ filter: config.filter, sort: config.sort });
  const issues = createQuery(() => ({
    queryKey: keys.issueList(projectKey, listQuery),
    queryFn: () => fetchers.issues(projectKey, listQuery),
    enabled: project.loaded,
  }));

  const peek = $derived(page.state.peek);
  function open(key: string) {
    pushPageState({ peek: key });
  }
  function closePeek() {
    history.back();
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <header class="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2">
    <div class="flex items-center">
      <ViewMenu {project} {view} {config} layout={effectiveLayout} {dirty} />
      {#if dirty}<span class="ml-1 text-xs text-fg-subtle" data-testid="view-modified"
          >· modified</span
        >{/if}
    </div>
    <FilterBar
      filter={config.filter}
      {project}
      onchange={(filter) => setConfig({ ...config, filter })}
    />
    <div class="ml-auto flex items-center gap-2">
      {#if dirty}
        <button
          class="text-xs text-fg-subtle hover:text-fg"
          onclick={() => setConfig(saved)}
          data-testid="view-reset">Reset</button
        >
      {/if}
      <span class="text-xs text-fg-subtle" data-testid="issue-count"
        >{issues.data?.length ?? '…'} issues</span
      >
      <ViewConfigPanel {config} layout={effectiveLayout} {project} onchange={setConfig} />
    </div>
  </header>

  <div class="relative flex min-h-0 flex-1">
    {#if issues.isError}
      <p class="p-6 text-sm text-danger">Couldn't load issues: {issues.error.message}</p>
    {:else if !issues.data}
      <p class="p-6 text-sm text-fg-subtle">Loading…</p>
    {:else}
      {#if effectiveLayout === 'board'}
        <Board issues={issues.data} {config} {project} onopen={open} active={peek} />
      {:else}
        <IssueList issues={issues.data} {config} {project} onopen={open} active={peek} />
      {/if}
    {/if}

    {#if peek}
      <aside
        class="absolute inset-y-0 right-0 z-20 w-[min(560px,100%)] border-l border-border bg-bg shadow-xl"
        data-testid="peek-panel"
      >
        {#key peek}
          <IssueDetail issueKey={peek} onopen={open} onclose={closePeek} panel />
        {/key}
      </aside>
    {/if}
  </div>
</div>
