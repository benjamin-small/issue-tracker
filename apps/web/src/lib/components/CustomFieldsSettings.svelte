<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import Archive from '@lucide/svelte/icons/archive';
  import ArchiveRestore from '@lucide/svelte/icons/archive-restore';
  import X from '@lucide/svelte/icons/x';
  import { createQuery } from '@tanstack/svelte-query';
  import { api, call, type CustomField, errorMessage } from '../api.ts';
  import { keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';

  /** Manage a project's custom fields: create (with options), rename, add/archive options, archive fields. */
  let { projectKey }: { projectKey: string } = $props();
  const qc = useQueryClient();

  const TYPES = [
    'text',
    'number',
    'date',
    'boolean',
    'select',
    'multi_select',
    'user',
    'url',
  ] as const;
  const all = createQuery(() => ({
    queryKey: [...keys.fields(projectKey), 'all'],
    queryFn: async () =>
      (
        await call(
          api.GET('/projects/{project}/fields', {
            params: { path: { project: projectKey }, query: { includeArchived: 'true' } },
          }),
        )
      ).data,
  }));

  let draft = $state({ key: '', name: '', type: 'select' as (typeof TYPES)[number], options: '' });
  const newOption = $state<Record<string, string>>({});

  async function run<T>(action: Promise<T>): Promise<T | undefined> {
    try {
      const result = await action;
      void qc.invalidateQueries({ queryKey: ['fields', projectKey] });
      void qc.invalidateQueries({ queryKey: keys.issueLists(projectKey) });
      return result;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return undefined;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    const options =
      draft.type === 'select' || draft.type === 'multi_select'
        ? draft.options
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
            .map((value) => ({ value }))
        : [];
    const created = await run(
      call(
        api.POST('/projects/{project}/fields', {
          params: { path: { project: projectKey } },
          body: {
            key: draft.key.trim(),
            name: draft.name.trim() || draft.key.trim(),
            type: draft.type,
            options,
          },
        }),
      ),
    );
    if (created) draft = { key: '', name: '', type: draft.type, options: '' };
  }

  function update(field: CustomField, body: { name?: string; archived?: boolean }) {
    return run(call(api.PATCH('/fields/{id}', { params: { path: { id: field.id } }, body })));
  }

  async function addOption(field: CustomField) {
    const value = (newOption[field.id] ?? '').trim();
    if (!value) return;
    const updated = await run(
      call(
        api.POST('/fields/{id}/options', { params: { path: { id: field.id } }, body: { value } }),
      ),
    );
    if (updated) newOption[field.id] = '';
  }

  function setOption(
    optionId: string,
    body: { label?: string; archived?: boolean; color?: string },
  ) {
    return run(
      call(api.PATCH('/field-options/{id}', { params: { path: { id: optionId } }, body })),
    );
  }

  const input =
    'rounded border border-border bg-bg px-2 py-1 text-sm outline-none focus:border-accent';
</script>

<section data-testid="settings-fields">
  <h2 class="mb-1 font-medium">Custom fields</h2>
  <p class="mb-3 text-sm text-fg-muted">
    Fields appear on the issue sidebar, can be shown on cards and list columns, used to group the
    board, and set by agents with
    <code class="font-mono text-xs">tracker issue edit KEY --set key=value</code>.
  </p>
  <ul class="space-y-2">
    {#each all.data ?? [] as field (field.id)}
      <li
        class="rounded-lg border border-border p-3 {field.archivedAt ? 'opacity-60' : ''}"
        data-field-key={field.key}
      >
        <div class="flex items-center gap-2">
          <input
            class="{input} w-44"
            value={field.name}
            aria-label="Field name"
            onchange={(e) => update(field, { name: e.currentTarget.value })}
          />
          <code class="rounded bg-bg-muted px-1.5 py-0.5 text-xs text-fg-muted">cf:{field.key}</code
          >
          <span class="text-xs text-fg-subtle">{field.type}</span>
          <button
            class="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-fg-muted hover:bg-bg-hover"
            onclick={() => update(field, { archived: !field.archivedAt })}
          >
            {#if field.archivedAt}<ArchiveRestore size={13} /> Restore{:else}<Archive size={13} /> Archive{/if}
          </button>
        </div>
        {#if field.type === 'select' || field.type === 'multi_select'}
          <div class="mt-2 flex flex-wrap items-center gap-1.5">
            {#each field.options as option (option.id)}
              <span
                class="inline-flex items-center gap-1 rounded-full border border-border py-0.5 pr-1 pl-1.5 text-xs {option.archivedAt
                  ? 'line-through opacity-60'
                  : ''}"
              >
                <input
                  type="color"
                  class="size-3.5 cursor-pointer rounded-full border-0 bg-transparent p-0"
                  value={option.color}
                  aria-label="Option color"
                  onchange={(e) => setOption(option.id, { color: e.currentTarget.value })}
                />
                {option.label}
                <button
                  class="rounded-full p-0.5 text-fg-subtle hover:text-fg"
                  aria-label={option.archivedAt ? 'Restore option' : 'Archive option'}
                  onclick={() => setOption(option.id, { archived: !option.archivedAt })}
                  ><X size={11} /></button
                >
              </span>
            {/each}
            <form class="inline-flex" onsubmit={(e) => (e.preventDefault(), addOption(field))}>
              <input
                class="{input} w-28 py-0.5 text-xs"
                placeholder="Add option"
                aria-label="New option"
                bind:value={newOption[field.id]}
              />
            </form>
          </div>
        {/if}
      </li>
    {:else}
      <li class="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-fg-subtle">
        No custom fields yet.
      </li>
    {/each}
  </ul>

  <form class="mt-3 flex flex-wrap gap-2" onsubmit={create} data-testid="new-field">
    <input class="{input} w-32" placeholder="key" aria-label="Field key" bind:value={draft.key} />
    <input
      class="{input} w-40"
      placeholder="Name"
      aria-label="Field name"
      bind:value={draft.name}
    />
    <select class={input} aria-label="Field type" bind:value={draft.type}>
      {#each TYPES as type (type)}<option value={type}>{type}</option>{/each}
    </select>
    {#if draft.type === 'select' || draft.type === 'multi_select'}
      <input
        class="{input} flex-1"
        placeholder="Options, comma-separated"
        aria-label="Field options"
        bind:value={draft.options}
      />
    {/if}
    <button
      class="rounded-md bg-accent px-3 text-sm text-accent-fg disabled:opacity-50"
      disabled={!draft.key.trim()}>Add field</button
    >
  </form>
</section>
