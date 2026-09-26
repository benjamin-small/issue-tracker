<script lang="ts">
  import Search from '@lucide/svelte/icons/search';
  import X from '@lucide/svelte/icons/x';
  import type { IssueFilter } from '@tracker/schema';
  import { PRIORITY_LABELS, PRIORITY_ORDER } from '../format.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import Avatar from './Avatar.svelte';
  import Picker from './Picker.svelte';
  import PriorityIcon from './PriorityIcon.svelte';
  import StatusIcon from './StatusIcon.svelte';

  /** Quick filters over the view's IssueFilter: text, status, assignee, labels, priority (each "any of"). */
  let {
    filter,
    project,
    onchange,
  }: { filter: IssueFilter; project: ProjectData; onchange: (f: IssueFilter) => void } = $props();

  type Value = string | number | null;
  const valuesOf = (field: string): Value[] =>
    (filter.conditions.find((c) => c.field === field && c.op === 'in')?.value as
      Value[] | undefined) ?? [];
  const text = $derived(
    (filter.conditions.find((c) => c.field === 'text')?.value as string | undefined) ?? '',
  );
  const others = $derived(
    filter.conditions.filter(
      (c) =>
        !(['status', 'assignee', 'labels', 'priority'].includes(c.field) && c.op === 'in') &&
        c.field !== 'text',
    ),
  );

  function setIn(field: string, values: Value[]) {
    const rest = filter.conditions.filter((c) => !(c.field === field && c.op === 'in'));
    onchange({ conditions: values.length ? [...rest, { field, op: 'in', value: values }] : rest });
  }
  function toggle(field: string, value: Value) {
    const current = valuesOf(field);
    setIn(
      field,
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  }

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function onsearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const rest = filter.conditions.filter((c) => c.field !== 'text');
      onchange({
        conditions: value.trim()
          ? [...rest, { field: 'text', op: 'contains', value: value.trim() }]
          : rest,
      });
    }, 250);
  }

  const chip = 'border border-dashed border-border text-xs text-fg-muted';
</script>

<div class="flex flex-wrap items-center gap-1.5" data-testid="filter-bar">
  <label
    class="flex items-center gap-1.5 rounded-md border border-border bg-bg px-2 py-1 text-sm focus-within:border-border-strong"
  >
    <Search size={13} class="text-fg-subtle" />
    <input
      value={text}
      oninput={onsearch}
      placeholder="Search…"
      aria-label="Search issues"
      data-testid="search"
      class="w-40 bg-transparent outline-none placeholder:text-fg-subtle"
    />
  </label>

  <Picker
    items={project.statuses.map((s) => ({ value: s.id, label: s.name, s }))}
    selected={valuesOf('status') as string[]}
    multiple
    onselect={(v) => toggle('status', v)}
    triggerLabel="Filter by status"
    triggerClass={chip}
    testid="filter-status"
  >
    {#snippet trigger()}Status{#if valuesOf('status').length}<b class="text-accent"
          >· {valuesOf('status').length}</b
        >{/if}{/snippet}
    {#snippet item(it)}<StatusIcon category={it.s.category} color={it.s.color} /><span
        >{it.label}</span
      >{/snippet}
  </Picker>

  <Picker
    items={[
      { value: '__none__', label: 'No assignee', u: null },
      ...project.users.map((u) => ({ value: u.id, label: u.name, keywords: [u.handle], u })),
    ]}
    selected={valuesOf('assignee').map((v) => (v === null ? '__none__' : String(v)))}
    multiple
    onselect={(v) => toggle('assignee', v === '__none__' ? null : v)}
    triggerLabel="Filter by assignee"
    triggerClass={chip}
    testid="filter-assignee"
  >
    {#snippet trigger()}Assignee{#if valuesOf('assignee').length}<b class="text-accent"
          >· {valuesOf('assignee').length}</b
        >{/if}{/snippet}
    {#snippet item(it)}<Avatar user={it.u} size={16} /><span>{it.label}</span>{/snippet}
  </Picker>

  <Picker
    items={project.labels.map((l) => ({ value: l.id, label: l.name, l }))}
    selected={valuesOf('labels') as string[]}
    multiple
    onselect={(v) => toggle('labels', v)}
    triggerLabel="Filter by label"
    triggerClass={chip}
    testid="filter-labels"
  >
    {#snippet trigger()}Labels{#if valuesOf('labels').length}<b class="text-accent"
          >· {valuesOf('labels').length}</b
        >{/if}{/snippet}
    {#snippet item(it)}<span class="size-2.5 rounded-full" style:background={it.l.color}
      ></span><span>{it.label}</span>{/snippet}
  </Picker>

  <Picker
    items={PRIORITY_ORDER.map((p) => ({ value: String(p), label: PRIORITY_LABELS[p], p }))}
    selected={valuesOf('priority').map(String)}
    multiple
    onselect={(v) => toggle('priority', Number(v))}
    triggerLabel="Filter by priority"
    triggerClass={chip}
    testid="filter-priority"
  >
    {#snippet trigger()}Priority{#if valuesOf('priority').length}<b class="text-accent"
          >· {valuesOf('priority').length}</b
        >{/if}{/snippet}
    {#snippet item(it)}<PriorityIcon priority={it.p} /><span>{it.label}</span>{/snippet}
  </Picker>

  {#each others as c, i (i)}
    <span
      class="inline-flex items-center gap-1 rounded-md bg-bg-muted px-2 py-1 text-xs text-fg-muted"
    >
      {c.field}
      {c.op}
      {JSON.stringify(c.value)}
      <button
        aria-label="Remove filter"
        onclick={() => onchange({ conditions: filter.conditions.filter((x) => x !== c) })}
        class="hover:text-fg"><X size={12} /></button
      >
    </span>
  {/each}

  {#if filter.conditions.length}
    <button
      class="text-xs text-fg-subtle hover:text-fg"
      onclick={() => onchange({ conditions: [] })}>Clear</button
    >
  {/if}
</div>
