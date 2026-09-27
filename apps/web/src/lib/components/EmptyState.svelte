<script lang="ts">
  import type { Component, Snippet } from 'svelte';

  /** A centred message for empty, missing and error states, with optional actions. */
  let {
    icon: Icon,
    title,
    children,
    actions,
    tone = 'neutral',
    testid,
  }: {
    icon?: Component<{ size?: number }>;
    title: string;
    children?: Snippet;
    actions?: Snippet;
    tone?: 'neutral' | 'danger';
    testid?: string;
  } = $props();
</script>

<div class="m-auto flex max-w-sm flex-col items-center px-6 py-12 text-center" data-testid={testid}>
  {#if Icon}
    <div
      class="mb-4 flex size-11 items-center justify-center rounded-xl {tone === 'danger'
        ? 'bg-danger/10 text-danger'
        : 'bg-bg-muted text-fg-subtle'}"
    >
      <Icon size={20} />
    </div>
  {/if}
  <h2 class="mb-1 font-semibold text-balance">{title}</h2>
  {#if children}<div class="text-sm text-balance text-fg-muted">{@render children()}</div>{/if}
  {#if actions}<div class="mt-5 flex flex-wrap justify-center gap-2">{@render actions()}</div>{/if}
</div>
