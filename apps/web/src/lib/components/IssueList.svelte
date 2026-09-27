<script lang="ts">
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Plus from '@lucide/svelte/icons/plus';
  import type { Issue } from '../api.ts';
  import { groupIssues } from '../grouping.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import { openCreateIssue } from '../ui.svelte.ts';
  import type { ViewConfig } from '../views.ts';
  import FieldValue from './FieldValue.svelte';
  import GroupHeader from './GroupHeader.svelte';

  /** Issue list with configurable columns (field registry keys) and optional grouping. */
  let {
    issues,
    config,
    project,
    onopen,
    active,
  }: {
    issues: Issue[];
    config: ViewConfig;
    project: ProjectData;
    onopen: (key: string) => void;
    active?: string;
  } = $props();

  const groups = $derived(groupIssues(issues, config.list.groupBy, project, false));
  const columns = $derived(
    config.list.columns.map((c) => c.field).filter((f) => f !== 'title' && f !== 'key'),
  );
  const showKey = $derived(config.list.columns.some((c) => c.field === 'key'));
  let collapsed = $state<Record<string, boolean>>({});
  const dense = $derived(config.density === 'compact');
</script>

<div class="min-h-0 flex-1 overflow-y-auto" data-testid="issue-list">
  {#each groups as group (group.id)}
    {#if config.list.groupBy}
      <div
        class="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-bg-subtle px-4 py-1.5 text-sm"
      >
        <button
          class="flex items-center gap-2"
          onclick={() => (collapsed[group.id] = !collapsed[group.id])}
        >
          <ChevronDown
            size={14}
            class="text-fg-subtle transition-transform {collapsed[group.id] ? '-rotate-90' : ''}"
          />
          <GroupHeader spec={group.header} />
          <span class="text-xs text-fg-subtle">{group.issues.length}</span>
        </button>
        {#if config.list.groupBy === 'status'}
          <button
            class="ml-auto rounded p-0.5 text-fg-subtle hover:bg-bg-hover hover:text-fg"
            aria-label="New issue in {group.label}"
            onclick={() => openCreateIssue(project.key, { status: group.id })}
            ><Plus size={14} /></button
          >
        {/if}
      </div>
    {/if}
    {#if !collapsed[group.id]}
      <ul>
        {#each group.issues as issue (issue.id)}
          <li
            class="group flex items-center gap-2 border-b border-border px-4 hover:bg-bg-subtle {dense
              ? 'py-1'
              : 'py-1.5'} {active === issue.key ? 'bg-accent-subtle' : ''}"
            data-testid="issue-row"
            data-key={issue.key}
          >
            {#if showKey}<span class="w-16 shrink-0"
                ><FieldValue {issue} field="key" {project} /></span
              >{/if}
            <button class="min-w-0 flex-1 truncate text-left" onclick={() => onopen(issue.key)}
              >{issue.title}</button
            >
            {#each columns as field (field)}
              <span class="flex shrink-0 items-center" data-field={field}>
                <FieldValue {issue} {field} {project} compact={field !== 'status'} />
              </span>
            {/each}
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="p-10 text-center text-sm text-fg-subtle" data-testid="empty-list">
      No issues match this view.
    </div>
  {/each}
</div>
