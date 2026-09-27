<script lang="ts">
  import { btn } from '../styles.ts';
  import { current, href, navigate } from '$lib/nav.ts';
  import { confirmAction } from '$lib/confirm.svelte.ts';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { Popover } from 'bits-ui';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import KanbanSquare from '@lucide/svelte/icons/square-kanban';
  import List from '@lucide/svelte/icons/list';
  import Lock from '@lucide/svelte/icons/lock';
  import { api, call, errorMessage, type View } from '../api.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import { keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';
  import type { ViewConfig } from '../views.ts';

  /** Switch between saved views, save the current (modified) config, save as a new view, or delete. */
  let {
    project,
    view,
    config,
    layout,
    dirty,
  }: {
    project: ProjectData;
    view: View | undefined;
    config: ViewConfig;
    layout: 'list' | 'board';
    dirty: boolean;
  } = $props();

  const qc = useQueryClient();
  let open = $state(false);
  let saving = $state(false);
  let newName = $state('');
  let shared = $state(false);

  const refresh = () => qc.invalidateQueries({ queryKey: keys.views(project.key) });

  async function save() {
    if (!view) return;
    try {
      await call(api.PATCH('/views/{id}', { params: { path: { id: view.id } }, body: { config } }));
      await refresh();
      open = false;
      toast(`Saved “${view.name}”`, 'success');
      await navigate(current().path, { replaceState: true, keepFocus: true, noScroll: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function saveAs(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = await call(
        api.POST('/projects/{project}/views', {
          params: { path: { project: project.key } },
          body: { name: newName.trim(), layout, config, shared },
        }),
      );
      await refresh();
      open = false;
      saving = false;
      newName = '';
      await navigate(`/p/${project.key}/v/${created.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!view) return;
    const ok = await confirmAction({
      title: `Delete the view “${view.name}”?`,
      body: view.ownerId
        ? 'This personal view will be gone. Issues are not affected.'
        : 'Everyone in the project loses this shared view. Issues are not affected.',
      confirmLabel: 'Delete view',
      danger: true,
    });
    if (!ok) return;
    try {
      await call(api.DELETE('/views/{id}', { params: { path: { id: view.id } } }));
      await refresh();
      open = false;
      await navigate(`/p/${project.key}${view.layout === 'board' ? '/board' : ''}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-semibold hover:bg-bg-hover"
    data-testid="view-menu"
  >
    {view?.name ?? (layout === 'board' ? 'Board' : 'All issues')}
    <ChevronDown size={14} class="text-fg-subtle" />
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={6}
      align="start"
      class="z-50 w-72 rounded-lg border border-border bg-bg p-1 text-sm shadow-lg"
    >
      <p class="px-2 pt-1 pb-1 text-xs font-medium text-fg-subtle">Views</p>
      {#each project.views as v (v.id)}
        <a
          href={href(`/p/${project.key}/v/${v.id}`)}
          onclick={() => (open = false)}
          class="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-bg-hover {v.id === view?.id
            ? 'font-medium'
            : 'text-fg-muted'}"
        >
          {#if v.layout === 'board'}<KanbanSquare size={14} />{:else}<List size={14} />{/if}
          <span class="truncate">{v.name}</span>
          {#if v.ownerId}<Lock
              size={12}
              class="ml-auto text-fg-subtle"
              aria-label="Personal"
            />{/if}
        </a>
      {/each}
      <div class="my-1 border-t border-border"></div>
      {#if dirty && view}
        <button
          class="w-full rounded px-2 py-1.5 text-left hover:bg-bg-hover"
          onclick={save}
          data-testid="view-save">Save changes to “{view.name}”</button
        >
      {/if}
      {#if saving}
        <form class="space-y-2 p-2" onsubmit={saveAs}>
          <input
            bind:value={newName}
            placeholder="View name"
            aria-label="View name"
            data-testid="view-name"
            class="w-full rounded border border-border bg-bg px-2 py-1 outline-none focus:border-accent"
          />
          <label class="flex items-center gap-2 text-xs text-fg-muted"
            ><input type="checkbox" bind:checked={shared} /> Share with the project</label
          >
          <button
            class="{btn.primarySm} w-full"
            disabled={!newName.trim()}
            data-testid="view-create">Create view</button
          >
        </form>
      {:else}
        <button
          class="w-full rounded px-2 py-1.5 text-left hover:bg-bg-hover"
          onclick={() => (saving = true)}
          data-testid="view-save-as">Save as new view…</button
        >
      {/if}
      {#if view && project.views.length > 1}
        <button
          class="w-full rounded px-2 py-1.5 text-left text-danger hover:bg-bg-hover"
          onclick={remove}>Delete view</button
        >
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
