<script lang="ts">
  import type { Issue } from '../api.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import FieldValue from './FieldValue.svelte';

  /** A board card: the title plus exactly the configured `board.cardFields`, in order. */
  let {
    issue,
    fields,
    project,
    density,
    active = false,
    focused = false,
    selected = false,
    onopen,
    onselect,
  }: {
    issue: Issue;
    fields: string[];
    project: ProjectData;
    density: 'compact' | 'comfortable';
    active?: boolean;
    focused?: boolean;
    selected?: boolean;
    onopen: (key: string) => void;
    /** ⌘/Ctrl- or shift-click: toggle selection (shift selects a range). */
    onselect?: (key: string, range: boolean) => void;
  } = $props();

  const showKey = $derived(fields.includes('key'));
  const rest = $derived(fields.filter((f) => f !== 'key' && f !== 'title'));
  /** Unset pickers (no assignee, no priority) stay faint until hovered, to keep cards quiet. */
  const unset = (field: string) =>
    (field === 'assignee' && !issue.assigneeId) || (field === 'priority' && issue.priority === 0);
</script>

<div
  class="group rounded-lg border bg-bg shadow-xs transition-colors hover:border-border-strong
    {active || selected ? 'border-accent' : 'border-border'} {selected
    ? 'bg-accent-subtle'
    : ''} {focused ? 'ring-2 ring-accent/50' : ''} {density === 'compact'
    ? 'px-2.5 py-1.5'
    : 'px-3 py-2.5'}"
  data-testid="issue-card"
  data-key={issue.key}
  data-focused={focused}
  data-selected={selected}
>
  <button
    class="block w-full text-left"
    onclick={(e) => {
      if (onselect && (e.metaKey || e.ctrlKey || e.shiftKey)) onselect(issue.key, e.shiftKey);
      else onopen(issue.key);
    }}
  >
    {#if showKey}<div class="mb-0.5 font-mono text-[11px] text-fg-subtle">{issue.key}</div>{/if}
    <div
      class="line-clamp-3 text-sm leading-snug font-medium {density === 'compact' ? '' : 'mb-1.5'}"
    >
      {issue.title}
    </div>
  </button>
  {#if rest.length}
    <div class="flex flex-wrap items-center gap-1" data-testid="card-fields">
      {#each rest as field (field)}
        <span
          class="inline-flex max-w-full items-center {unset(field)
            ? 'opacity-35 transition-opacity group-hover:opacity-100 focus-within:opacity-100'
            : ''}"
          data-field={field}
        >
          <FieldValue {issue} {field} {project} compact />
        </span>
      {/each}
    </div>
  {/if}
</div>
