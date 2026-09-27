<script lang="ts">
  import { FieldRegistry, SORTABLE_FIELDS } from '@tracker/schema';
  import { Popover } from 'bits-ui';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import type { ProjectData } from '../project-data.svelte.ts';
  import type { ViewConfig } from '../views.ts';
  import Select from './Select.svelte';
  import SortableList from './SortableList.svelte';

  /**
   * "Display" options for a view: grouping, ordering, density and — driven by the field registry — which
   * properties appear as list columns or on board cards, in which order.
   */
  let {
    config,
    layout,
    project,
    onchange,
  }: {
    config: ViewConfig;
    layout: 'list' | 'board';
    project: ProjectData;
    onchange: (c: ViewConfig) => void;
  } = $props();

  const registry = $derived(new FieldRegistry(project.customFields));
  const groupable = $derived(
    registry
      .all()
      .filter(
        (f) =>
          f.groupable &&
          (layout === 'list' ||
            ['status', 'priority', 'assignee'].includes(f.key) ||
            f.key.startsWith('cf:')),
      ),
  );
  const sortable = $derived(
    SORTABLE_FIELDS.map((key) => ({ key, label: registry.get(key)?.label ?? key })),
  );
  const displayable = $derived(registry.all().filter((f) => f.displayable && f.key !== 'title'));

  const selected = $derived(
    layout === 'list' ? config.list.columns.map((c) => c.field) : config.board.cardFields,
  );
  const shown = $derived(
    selected
      .filter((k) => k !== 'title')
      .map((k) => registry.get(k))
      .filter((f) => f !== undefined),
  );
  const hidden = $derived(displayable.filter((f) => !selected.includes(f.key)));

  function setFields(fields: string[]) {
    if (layout === 'list') {
      // Title is always present in lists; keep it right after the key if shown.
      onchange({
        ...config,
        list: { ...config.list, columns: fields.map((field) => ({ field })) },
      });
    } else {
      onchange({ ...config, board: { ...config.board, cardFields: fields } });
    }
  }
  /** Applies a dragged order; the title column (never listed) keeps its slot. */
  function reorder(ids: string[]) {
    const at = selected.indexOf('title');
    setFields(at < 0 ? ids : [...ids.slice(0, at), 'title', ...ids.slice(at)]);
  }
  function toggle(key: string) {
    setFields(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }
  const primarySort = $derived(config.sort[0] ?? { field: 'updatedAt', dir: 'desc' as const });
</script>

<Popover.Root>
  <Popover.Trigger
    class="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg"
    data-testid="display-options"
  >
    <SlidersHorizontal size={14} /> Display
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={6}
      align="end"
      class="z-50 w-80 space-y-4 rounded-lg border border-border bg-bg p-3 text-sm shadow-lg"
      data-testid="display-panel"
    >
      <div class="grid grid-cols-[90px_1fr] items-center gap-2">
        <span class="text-fg-muted">{layout === 'board' ? 'Columns' : 'Grouping'}</span>
        <Select
          label="Group by"
          testid="group-by"
          value={layout === 'board' ? config.board.groupBy : (config.list.groupBy ?? '')}
          items={[
            ...(layout === 'list' ? [{ value: '', label: 'No grouping' }] : []),
            ...groupable.map((f) => ({ value: f.key, label: f.label })),
          ]}
          onchange={(v) => {
            if (layout === 'board') onchange({ ...config, board: { ...config.board, groupBy: v } });
            else onchange({ ...config, list: { ...config.list, groupBy: v || null } });
          }}
        />

        <span class="text-fg-muted">Ordering</span>
        <div class="flex gap-1">
          <Select
            class="flex-1"
            label="Order by"
            testid="order-by"
            value={primarySort.field}
            items={sortable.map((f) => ({ value: f.key, label: f.label }))}
            onchange={(v) =>
              onchange({
                ...config,
                sort: [{ field: v, dir: v === 'rank' ? 'asc' : primarySort.dir }],
              })}
          />
          <button
            class="rounded-md border border-border px-2 text-fg-muted hover:bg-bg-hover hover:text-fg"
            aria-label="Toggle direction"
            title={primarySort.dir === 'asc' ? 'Ascending' : 'Descending'}
            onclick={() =>
              onchange({
                ...config,
                sort: [
                  { field: primarySort.field, dir: primarySort.dir === 'asc' ? 'desc' : 'asc' },
                ],
              })}>{primarySort.dir === 'asc' ? '↑' : '↓'}</button
          >
        </div>

        <span class="text-fg-muted">Density</span>
        <div class="flex gap-1">
          {#each ['comfortable', 'compact'] as const as d (d)}
            <button
              class="flex-1 rounded border px-2 py-1 capitalize {config.density === d
                ? 'border-accent bg-accent-subtle text-fg'
                : 'border-border text-fg-muted'}"
              onclick={() => onchange({ ...config, density: d })}>{d}</button
            >
          {/each}
        </div>
      </div>

      {#if layout === 'board'}
        <label class="flex items-center gap-2 text-fg-muted">
          <input
            type="checkbox"
            checked={config.board.showEmptyGroups}
            onchange={(e) =>
              onchange({
                ...config,
                board: { ...config.board, showEmptyGroups: e.currentTarget.checked },
              })}
          />
          Show empty columns
        </label>
      {/if}

      <div>
        <p class="mb-1.5 text-xs font-medium text-fg-subtle">
          {layout === 'board' ? 'Card properties' : 'List columns'}
          <span class="font-normal">· drag to reorder</span>
        </p>
        <div data-testid="display-fields">
          <SortableList
            items={shown.map((f) => ({ id: f.key, f }))}
            onreorder={reorder}
            label={(it) => `Reorder ${it.f.label}`}
            class="space-y-0.5"
            itemClass="rounded px-1 py-0.5 hover:bg-bg-hover"
          >
            {#snippet row(it)}
              {@render fieldToggle(it.f.key, it.f.label, true)}
            {/snippet}
          </SortableList>
          {#if hidden.length}
            <p class="mt-2 mb-1 text-xs text-fg-subtle">Hidden</p>
            <ul class="space-y-0.5">
              {#each hidden as f (f.key)}
                <li class="flex items-center gap-1.5 rounded px-1 py-0.5 pl-6 hover:bg-bg-hover">
                  {@render fieldToggle(f.key, f.label, false)}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

{#snippet fieldToggle(key: string, label: string, on: boolean)}
  <label class="flex flex-1 items-center gap-2">
    <input type="checkbox" checked={on} onchange={() => toggle(key)} data-field={key} />
    <span class={on ? '' : 'text-fg-muted'}>{label}</span>
  </label>
{/snippet}
