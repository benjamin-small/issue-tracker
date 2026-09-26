<script lang="ts">
  import X from '@lucide/svelte/icons/x';
  import { dismiss, toasts } from '../toast.svelte.ts';
</script>

<div
  class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2"
  aria-live="polite"
>
  {#each toasts as t (t.id)}
    <div
      role="status"
      data-testid="toast"
      class="pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg
        {t.kind === 'error' ? 'border-danger/40 bg-bg text-danger' : 'border-border bg-bg text-fg'}"
    >
      <span class="flex-1">{t.message}</span>
      {#if t.action}
        <button
          class="font-medium text-accent hover:underline"
          onclick={() => {
            t.action!.run();
            dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button
        class="text-fg-subtle hover:text-fg"
        aria-label="Dismiss"
        onclick={() => dismiss(t.id)}><X size={14} /></button
      >
    </div>
  {/each}
</div>
