<script lang="ts">
  import { page } from '$app/state';
  import { useQueryClient } from '@tanstack/svelte-query';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { api, call, errorMessage, type Label, type Status } from '$lib/api.ts';
  import { useProjectData } from '$lib/project-data.svelte.ts';
  import { keys } from '$lib/queries.ts';
  import { toast } from '$lib/toast.svelte.ts';
  import StatusIcon from '$components/StatusIcon.svelte';

  const key = $derived(page.params.key!.toUpperCase());
  const project = useProjectData(() => key);
  const qc = useQueryClient();
  const CATEGORIES = ['backlog', 'unstarted', 'started', 'completed', 'canceled'] as const;

  async function run<T>(
    action: Promise<T>,
    refresh: ReadonlyArray<readonly unknown[]>,
  ): Promise<T | undefined> {
    try {
      const result = await action;
      for (const k of refresh) void qc.invalidateQueries({ queryKey: k });
      return result;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return undefined;
    }
  }
  const statusKeys = $derived([keys.statuses(key), keys.issueLists(key)]);
  const labelKeys = $derived([keys.labels(key), keys.issueLists(key)]);

  let newStatus = $state({ name: '', category: 'unstarted' as (typeof CATEGORIES)[number] });
  let newLabel = $state({ name: '', color: '#5e6ad2' });

  function updateStatus(
    s: Status,
    body: { name?: string; category?: Status['category']; color?: string },
  ) {
    return run(
      call(api.PATCH('/statuses/{id}', { params: { path: { id: s.id } }, body })),
      statusKeys,
    );
  }
  function move(index: number, delta: number) {
    const ids = project.statuses.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    return run(
      call(
        api.POST('/projects/{project}/statuses/reorder', {
          params: { path: { project: key } },
          body: { ids },
        }),
      ),
      statusKeys,
    );
  }
  async function removeStatus(s: Status) {
    const others = project.statuses.filter((x) => x.id !== s.id);
    const target = prompt(
      `Delete "${s.name}"? Issues in it move to (status name):`,
      others[0]?.name ?? '',
    );
    if (target === null) return;
    await run(
      call(
        api.DELETE('/statuses/{id}', {
          params: { path: { id: s.id }, query: target ? { moveIssuesTo: target } : {} },
        }),
      ),
      statusKeys,
    );
  }
  async function addStatus(event: SubmitEvent) {
    event.preventDefault();
    const created = await run(
      call(
        api.POST('/projects/{project}/statuses', {
          params: { path: { project: key } },
          body: newStatus,
        }),
      ),
      statusKeys,
    );
    if (created) newStatus = { name: '', category: newStatus.category };
  }
  function updateLabel(l: Label, body: { name?: string; color?: string; description?: string }) {
    return run(
      call(api.PATCH('/labels/{id}', { params: { path: { id: l.id } }, body })),
      labelKeys,
    );
  }
  async function removeLabel(l: Label) {
    if (confirm(`Delete label "${l.name}"? It is removed from all issues.`))
      await run(call(api.DELETE('/labels/{id}', { params: { path: { id: l.id } } })), labelKeys);
  }
  async function addLabel(event: SubmitEvent) {
    event.preventDefault();
    const created = await run(
      call(
        api.POST('/projects/{project}/labels', {
          params: { path: { project: key } },
          body: newLabel,
        }),
      ),
      labelKeys,
    );
    if (created) newLabel = { name: '', color: newLabel.color };
  }

  const input =
    'rounded border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent';
</script>

<svelte:head><title>{key} · Settings</title></svelte:head>

<div class="overflow-y-auto">
  <div class="mx-auto max-w-3xl space-y-10 px-6 py-8">
    <h1 class="text-lg font-semibold">{key} settings</h1>

    <section data-testid="settings-statuses">
      <h2 class="mb-1 font-medium">Workflow</h2>
      <p class="mb-3 text-sm text-fg-muted">
        Statuses are the board columns. The category drives started/completed dates and default
        views.
      </p>
      <ul class="divide-y divide-border rounded-lg border border-border">
        {#each project.statuses as s, i (s.id)}
          <li class="flex items-center gap-2 px-3 py-2">
            <StatusIcon category={s.category} color={s.color} />
            <input
              class="{input} flex-1"
              value={s.name}
              aria-label="Status name"
              onchange={(e) => updateStatus(s, { name: e.currentTarget.value })}
            />
            <select
              class={input}
              value={s.category}
              aria-label="Category"
              onchange={(e) =>
                updateStatus(s, { category: e.currentTarget.value as Status['category'] })}
            >
              {#each CATEGORIES as c (c)}<option value={c}>{c}</option>{/each}
            </select>
            <input
              type="color"
              value={s.color}
              aria-label="Color"
              class="h-7 w-9 rounded border border-border bg-bg"
              onchange={(e) => updateStatus(s, { color: e.currentTarget.value })}
            />
            <button
              class="rounded p-1 text-fg-subtle hover:bg-bg-hover disabled:opacity-30"
              disabled={i === 0}
              aria-label="Move up"
              onclick={() => move(i, -1)}><ArrowUp size={14} /></button
            >
            <button
              class="rounded p-1 text-fg-subtle hover:bg-bg-hover disabled:opacity-30"
              disabled={i === project.statuses.length - 1}
              aria-label="Move down"
              onclick={() => move(i, 1)}><ArrowDown size={14} /></button
            >
            <button
              class="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-danger"
              aria-label="Delete status"
              onclick={() => removeStatus(s)}><Trash2 size={14} /></button
            >
          </li>
        {/each}
      </ul>
      <form class="mt-3 flex gap-2" onsubmit={addStatus}>
        <input
          class="{input} flex-1"
          placeholder="New status"
          bind:value={newStatus.name}
          aria-label="New status name"
        />
        <select class={input} bind:value={newStatus.category} aria-label="New status category">
          {#each CATEGORIES as c (c)}<option value={c}>{c}</option>{/each}
        </select>
        <button
          class="rounded-md bg-accent px-3 text-sm text-accent-fg disabled:opacity-50"
          disabled={!newStatus.name.trim()}>Add status</button
        >
      </form>
    </section>

    <section data-testid="settings-labels">
      <h2 class="mb-3 font-medium">Labels</h2>
      <ul class="divide-y divide-border rounded-lg border border-border">
        {#each project.labels as l (l.id)}
          <li class="flex items-center gap-2 px-3 py-2">
            <input
              type="color"
              value={l.color}
              aria-label="Color"
              class="h-7 w-9 rounded border border-border bg-bg"
              onchange={(e) => updateLabel(l, { color: e.currentTarget.value })}
            />
            <input
              class="{input} w-40"
              value={l.name}
              aria-label="Label name"
              onchange={(e) => updateLabel(l, { name: e.currentTarget.value })}
            />
            <input
              class="{input} flex-1"
              value={l.description}
              placeholder="Description"
              aria-label="Description"
              onchange={(e) => updateLabel(l, { description: e.currentTarget.value })}
            />
            <button
              class="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-danger"
              aria-label="Delete label"
              onclick={() => removeLabel(l)}><Trash2 size={14} /></button
            >
          </li>
        {:else}
          <li class="px-3 py-3 text-sm text-fg-subtle">No labels yet.</li>
        {/each}
      </ul>
      <form class="mt-3 flex gap-2" onsubmit={addLabel}>
        <input
          type="color"
          bind:value={newLabel.color}
          aria-label="New label color"
          class="h-8 w-10 rounded border border-border bg-bg"
        />
        <input
          class="{input} flex-1"
          placeholder="New label"
          bind:value={newLabel.name}
          aria-label="New label name"
        />
        <button
          class="rounded-md bg-accent px-3 text-sm text-accent-fg disabled:opacity-50"
          disabled={!newLabel.name.trim()}>Add label</button
        >
      </form>
    </section>
  </div>
</div>
