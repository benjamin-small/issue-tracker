<script lang="ts">
  import Markdown from './Markdown.svelte';

  /** Markdown textarea with Write/Preview tabs. Cmd/Ctrl+Enter submits, Escape cancels. */
  let {
    value = $bindable(''),
    placeholder = 'Write markdown…',
    rows = 6,
    autofocus = false,
    onsubmit,
    oncancel,
    testid,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    autofocus?: boolean;
    onsubmit?: () => void;
    oncancel?: () => void;
    testid?: string;
  } = $props();

  let tab = $state<'write' | 'preview'>('write');
  let textarea = $state<HTMLTextAreaElement>();

  $effect(() => {
    if (autofocus) textarea?.focus();
  });

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onsubmit?.();
    } else if (event.key === 'Escape') {
      oncancel?.();
    }
  }
</script>

<div class="rounded-md border border-border bg-bg focus-within:border-border-strong">
  <div class="flex gap-1 border-b border-border px-2 pt-1 text-xs">
    {#each ['write', 'preview'] as const as t (t)}
      <button
        type="button"
        class="rounded-t px-2 py-1 capitalize {tab === t
          ? 'text-fg'
          : 'text-fg-subtle hover:text-fg-muted'}"
        onclick={() => (tab = t)}>{t}</button
      >
    {/each}
    <span class="ml-auto self-center text-fg-subtle">Markdown · ⌘↵ to save</span>
  </div>
  {#if tab === 'write'}
    <textarea
      bind:this={textarea}
      bind:value
      {rows}
      {placeholder}
      {onkeydown}
      data-testid={testid}
      class="block w-full resize-y bg-transparent px-3 py-2 text-sm outline-none placeholder:text-fg-subtle"
    ></textarea>
  {:else}
    <div class="min-h-24 px-3 py-2">
      {#if value.trim()}<Markdown source={value} />{:else}<p class="text-sm text-fg-subtle">
          Nothing to preview
        </p>{/if}
    </div>
  {/if}
</div>
