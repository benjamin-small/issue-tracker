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
    onopen,
  }: {
    issue: Issue;
    fields: string[];
    project: ProjectData;
    density: 'compact' | 'comfortable';
    active?: boolean;
    onopen: (key: string) => void;
  } = $props();

  const showKey = $derived(fields.includes('key'));
  const rest = $derived(fields.filter((f) => f !== 'key' && f !== 'title'));
</script>

<div
  class="rounded-lg border bg-bg shadow-xs transition-colors hover:border-border-strong
    {active ? 'border-accent' : 'border-border'} {density === 'compact'
    ? 'px-2.5 py-1.5'
    : 'px-3 py-2.5'}"
  data-testid="issue-card"
  data-key={issue.key}
>
  <button class="block w-full text-left" onclick={() => onopen(issue.key)}>
    {#if showKey}<div class="mb-0.5 font-mono text-[11px] text-fg-subtle">{issue.key}</div>{/if}
    <div class="line-clamp-3 text-sm {density === 'compact' ? '' : 'mb-1'}">{issue.title}</div>
  </button>
  {#if rest.length}
    <div class="flex flex-wrap items-center gap-1" data-testid="card-fields">
      {#each rest as field (field)}
        <span class="inline-flex max-w-full items-center" data-field={field}>
          <FieldValue {issue} {field} {project} compact />
        </span>
      {/each}
    </div>
  {/if}
</div>
