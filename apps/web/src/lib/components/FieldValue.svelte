<script lang="ts">
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import GitBranch from '@lucide/svelte/icons/git-branch';
  import MessageSquare from '@lucide/svelte/icons/message-square';
  import type { Issue } from '../api.ts';
  import { isOverdue, relativeTime, shortDate } from '../format.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import AssigneePicker from './AssigneePicker.svelte';
  import Avatar from './Avatar.svelte';
  import LabelChip from './LabelChip.svelte';
  import PriorityPicker from './PriorityPicker.svelte';
  import StatusPicker from './StatusPicker.svelte';

  /**
   * Renders one field-registry field of an issue compactly — used for list columns and board card fields.
   * Status, priority and assignee are editable in place; custom fields (`cf:<key>`) render their value.
   */
  let {
    issue,
    field,
    project,
    compact = false,
  }: { issue: Issue; field: string; project: ProjectData; compact?: boolean } = $props();
</script>

{#if field === 'key'}
  <span class="shrink-0 font-mono text-xs text-fg-subtle">{issue.key}</span>
{:else if field === 'title'}
  <span class="truncate">{issue.title}</span>
{:else if field === 'status'}
  <StatusPicker {issue} statuses={project.statuses} showLabel={!compact} />
{:else if field === 'priority'}
  <PriorityPicker {issue} showLabel={!compact} />
{:else if field === 'assignee'}
  <AssigneePicker {issue} users={project.users} showLabel={!compact} />
{:else if field === 'creator'}
  <span class="inline-flex items-center gap-1.5 text-xs text-fg-muted"
    ><Avatar user={issue.creator} size={16} />{#if !compact}{issue.creator.name}{/if}</span
  >
{:else if field === 'labels'}
  {#if issue.labels.length}<span class="flex min-w-0 flex-wrap gap-1"
      >{#each issue.labels as l (l.id)}<LabelChip label={l} />{/each}</span
    >{/if}
{:else if field === 'estimate'}
  {#if issue.estimate !== null}<span
      class="rounded border border-border px-1 text-xs text-fg-muted"
      title="Estimate">{issue.estimate}</span
    >{/if}
{:else if field === 'dueDate'}
  {#if issue.dueDate}
    <span
      class="inline-flex items-center gap-1 text-xs {isOverdue(
        issue.dueDate,
        issue.status.category === 'completed' || issue.status.category === 'canceled',
      )
        ? 'text-danger'
        : 'text-fg-muted'}"
      title="Due date"><CalendarDays size={12} />{shortDate(issue.dueDate)}</span
    >
  {/if}
{:else if field === 'commentCount'}
  {#if issue.commentCount}<span class="inline-flex items-center gap-1 text-xs text-fg-muted"
      ><MessageSquare size={12} />{issue.commentCount}</span
    >{/if}
{:else if field === 'childCount'}
  {#if issue.childCount}<span class="inline-flex items-center gap-1 text-xs text-fg-muted"
      ><GitBranch size={12} />{issue.childCount}</span
    >{/if}
{:else if field === 'parent'}
  {#if issue.parent}<span class="truncate text-xs text-fg-subtle" title={issue.parent.title}
      >↳ {issue.parent.key}</span
    >{/if}
{:else if field === 'createdAt' || field === 'updatedAt' || field === 'completedAt'}
  {#if issue[field]}<span class="text-xs whitespace-nowrap text-fg-subtle" title={issue[field]}
      >{relativeTime(issue[field]!)}</span
    >{/if}
{:else if field.startsWith('cf:')}
  {@const value = issue.customFields[field.slice(3)]}
  {#if value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)}
    <span class="truncate rounded bg-bg-muted px-1.5 text-xs text-fg-muted" title={field.slice(3)}>
      {Array.isArray(value)
        ? value.join(', ')
        : typeof value === 'boolean'
          ? value
            ? '✓'
            : '✗'
          : String(value)}
    </span>
  {/if}
{/if}
