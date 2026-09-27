<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import CircleDashed from '@lucide/svelte/icons/circle-dashed';
  import SignalHigh from '@lucide/svelte/icons/signal-high';
  import Tag from '@lucide/svelte/icons/tag';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import UserRound from '@lucide/svelte/icons/user-round';
  import X from '@lucide/svelte/icons/x';
  import { cachedIssues, deleteIssues } from '../issues.ts';
  import { clearSelection, selection } from '../selection.svelte.ts';
  import { type CommandMode, openCommand } from '../ui.svelte.ts';

  /** Floating actions for the selected issues. */
  const qc = useQueryClient();
  const count = $derived(selection.selected.length);
  const actions: Array<[CommandMode, string, typeof Tag]> = [
    ['status', 'Status', CircleDashed],
    ['assignee', 'Assignee', UserRound],
    ['priority', 'Priority', SignalHigh],
    ['labels', 'Labels', Tag],
  ];
</script>

{#if count > 0}
  <div
    class="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-border bg-bg p-1.5 text-sm shadow-xl"
    role="toolbar"
    aria-label="Selected issues"
    data-testid="selection-bar"
  >
    <span class="px-2 font-medium whitespace-nowrap" data-testid="selection-count"
      >{count} selected</span
    >
    {#each actions as [mode, label, Icon] (mode)}
      <button
        class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap text-fg-muted hover:bg-bg-hover hover:text-fg"
        onclick={() => openCommand(mode, [...selection.selected])}><Icon size={14} />{label}</button
      >
    {/each}
    <button
      class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap text-fg-muted hover:bg-bg-hover hover:text-danger"
      onclick={async () => {
        await deleteIssues(qc, cachedIssues(qc, selection.selected));
        clearSelection();
      }}><Trash2 size={14} />Delete</button
    >
    <button
      class="rounded-md p-1 text-fg-subtle hover:bg-bg-hover hover:text-fg"
      aria-label="Clear selection"
      onclick={clearSelection}><X size={14} /></button
    >
  </div>
{/if}
