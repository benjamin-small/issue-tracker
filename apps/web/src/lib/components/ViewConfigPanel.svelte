<script lang="ts">
  import { FieldRegistry, SORTABLE_FIELDS } from '@tracker/schema';
  import { Popover } from 'bits-ui';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import type { ProjectData } from '../project-data.svelte.ts';
  import type { ViewConfig } from '../views.ts';

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
  const ordered = $derived([
    ...selected
      .filter((k) => k !== 'title')
      .map((k) => registry.get(k))
      .filter((f) => f !== undefined),
    ...displayable.filter((f) => !selected.includes(f.key)),
  ]);

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
  function toggle(key: string) {
    setFields(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }
  function move(key: string, delta: number) {
    const fields = [...selected];
    const i = fields.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= fields.length) return;
    [fields[i], fields[j]] = [fields[j]!, fields[i]!];
    setFields(fields);
  }

  const primarySort = $derived(config.sort[0] ?? { field: 'updatedAt', dir: 'desc' as const });
  const select = 'rounded border border-border bg-bg px-1.5 py-1 text-sm';
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
        <select
          class={select}
          aria-label="Group by"
          value={layout === 'board' ? config.board.groupBy : (config.list.groupBy ?? '')}
          onchange={(e) => {
            const v = e.currentTarget.value;
            if (layout === 'board') onchange({ ...config, board: { ...config.board, groupBy: v } });
            else onchange({ ...config, list: { ...config.list, groupBy: v || null } });
          }}
        >
          {#if layout === 'list'}<option value="">No grouping</option>{/if}
          {#each groupable as f (f.key)}<option value={f.key}>{f.label}</option>{/each}
        </select>

        <span class="text-fg-muted">Ordering</span>
        <div class="flex gap-1">
          <select
            class="{select} flex-1"
            aria-label="Order by"
            value={primarySort.field}
            onchange={(e) =>
              onchange({
                ...config,
                sort: [
                  {
                    field: e.currentTarget.value,
                    dir: e.currentTarget.value === 'rank' ? 'asc' : primarySort.dir,
                  },
                ],
              })}
          >
            {#each sortable as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
          </select>
          <button
            class="rounded border border-border px-2 hover:bg-bg-hover"
            aria-label="Toggle direction"
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
        </p>
        <ul class="space-y-0.5" data-testid="display-fields">
          {#each ordered as f (f.key)}
            {@const on = selected.includes(f.key)}
            <li class="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-bg-hover">
              <label class="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onchange={() => toggle(f.key)}
                  data-field={f.key}
                />
                <span class={on ? '' : 'text-fg-muted'}>{f.label}</span>
              </label>
              {#if on}
                <button
                  class="rounded p-0.5 text-fg-subtle hover:text-fg"
                  aria-label="Move {f.label} up"
                  onclick={() => move(f.key, -1)}><ArrowUp size={12} /></button
                >
                <button
                  class="rounded p-0.5 text-fg-subtle hover:text-fg"
                  aria-label="Move {f.label} down"
                  onclick={() => move(f.key, 1)}><ArrowDown size={12} /></button
                >
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
