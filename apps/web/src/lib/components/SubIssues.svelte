<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import Plus from '@lucide/svelte/icons/plus';
  import type { Issue } from '../api.ts';
  import { projectKeyOf } from '../issues.ts';
  import { fetchers, keys } from '../queries.ts';
  import { openCreateIssue } from '../ui.svelte.ts';
  import StatusIcon from './StatusIcon.svelte';

  let { issue, onopen }: { issue: Issue; onopen: (key: string) => void } = $props();
  const children = createQuery(() => ({
    queryKey: keys.children(issue.key),
    queryFn: () => fetchers.children(issue.key),
  }));
  const done = $derived(
    (children.data ?? []).filter((c) => ['completed', 'canceled'].includes(c.status.category))
      .length,
  );
</script>

<section data-testid="sub-issues">
  <div class="mb-2 flex items-center gap-2">
    <h3 class="text-sm font-semibold">Sub-issues</h3>
    {#if children.data?.length}<span class="text-xs text-fg-subtle"
        >{done}/{children.data.length}</span
      >{/if}
    <button
      class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-hover"
      onclick={() => openCreateIssue(projectKeyOf(issue.key), { parent: issue.key })}
      data-testid="add-sub-issue"><Plus size={12} /> Add</button
    >
  </div>
  {#if children.data?.length}
    <div
      class="mb-2 h-1 overflow-hidden rounded-full bg-bg-muted"
      role="progressbar"
      aria-label="Sub-issues done"
      aria-valuemin={0}
      aria-valuemax={children.data.length}
      aria-valuenow={done}
    >
      <div
        class="h-full rounded-full bg-success transition-[width]"
        style:width="{(done / children.data.length) * 100}%"
      ></div>
    </div>
    <ul class="divide-y divide-border rounded-md border border-border">
      {#each children.data as child (child.id)}
        <li>
          <button
            class="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
            onclick={() => onopen(child.key)}
          >
            <StatusIcon category={child.status.category} color={child.status.color} />
            <span class="font-mono text-xs text-fg-subtle">{child.key}</span>
            <span class="truncate">{child.title}</span>
          </button>
        </li>
      {/each}
    </ul>
  {:else if children.data}
    <p class="text-sm text-fg-subtle">No sub-issues. Break the work down with Add.</p>
  {/if}
</section>
