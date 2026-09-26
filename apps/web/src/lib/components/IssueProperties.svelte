<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import type { Issue } from '../api.ts';
  import { relativeTime } from '../format.ts';
  import { updateIssue } from '../issues.ts';
  import type { ProjectData } from '../project-data.svelte.ts';
  import AssigneePicker from './AssigneePicker.svelte';
  import Avatar from './Avatar.svelte';
  import LabelPicker from './LabelPicker.svelte';
  import PriorityPicker from './PriorityPicker.svelte';
  import StatusPicker from './StatusPicker.svelte';
  import type { Snippet } from 'svelte';

  let { issue, project, extra }: { issue: Issue; project: ProjectData; extra?: Snippet } = $props();
  const qc = useQueryClient();

  function setEstimate(event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    const estimate = raw === '' ? null : Number(raw);
    if (estimate !== null && Number.isNaN(estimate)) return;
    if (estimate !== issue.estimate) void updateIssue(qc, issue, { estimate }, { estimate });
  }

  function setDue(event: Event) {
    const dueDate = (event.target as HTMLInputElement).value || null;
    if (dueDate !== issue.dueDate) void updateIssue(qc, issue, { dueDate }, { dueDate });
  }
</script>

{#snippet row(label: string, content: Snippet)}
  <div class="grid grid-cols-[88px_1fr] items-center gap-2 py-0.5">
    <span class="text-xs text-fg-subtle">{label}</span>
    <div class="min-w-0">{@render content()}</div>
  </div>
{/snippet}

<div class="space-y-0.5 text-sm" data-testid="issue-properties">
  {#snippet status()}<StatusPicker {issue} statuses={project.statuses} />{/snippet}
  {#snippet priority()}<PriorityPicker {issue} />{/snippet}
  {#snippet assignee()}<AssigneePicker {issue} users={project.users} />{/snippet}
  {#snippet labels()}<LabelPicker {issue} labels={project.labels} />{/snippet}
  {#snippet estimate()}
    <input
      type="number"
      min="0"
      step="0.5"
      value={issue.estimate ?? ''}
      placeholder="—"
      aria-label="Estimate"
      onchange={setEstimate}
      class="w-20 rounded bg-transparent px-1.5 py-1 hover:bg-bg-hover focus:bg-bg-hover focus:outline-none"
    />
  {/snippet}
  {#snippet due()}
    <input
      type="date"
      value={issue.dueDate ?? ''}
      aria-label="Due date"
      onchange={setDue}
      class="rounded bg-transparent px-1.5 py-1 text-sm hover:bg-bg-hover focus:outline-none"
    />
  {/snippet}
  {#snippet creator()}
    <span class="inline-flex items-center gap-1.5 px-1.5 text-fg-muted"
      ><Avatar user={issue.creator} size={16} />{issue.creator.name} · {relativeTime(
        issue.createdAt,
      )}</span
    >
  {/snippet}
  {@render row('Status', status)}
  {@render row('Priority', priority)}
  {@render row('Assignee', assignee)}
  {@render row('Labels', labels)}
  {@render row('Estimate', estimate)}
  {@render row('Due date', due)}
  {@render extra?.()}
  {@render row('Created by', creator)}
</div>
