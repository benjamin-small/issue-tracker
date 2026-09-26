<script lang="ts">
  import { errorMessage } from '../api.ts';
  import { toast } from '../toast.svelte.ts';
  import Markdown from './Markdown.svelte';

  /**
   * Markdown textarea with Write/Preview tabs. Cmd/Ctrl+Enter submits, Escape cancels. With `upload`, files
   * pasted or dropped into the textarea are uploaded and replaced by the markdown `upload` returns.
   */
  let {
    value = $bindable(''),
    placeholder = 'Write markdown…',
    rows = 6,
    autofocus = false,
    onsubmit,
    oncancel,
    testid,
    upload,
  }: {
    value?: string;
    placeholder?: string;
    rows?: number;
    autofocus?: boolean;
    onsubmit?: () => void;
    oncancel?: () => void;
    testid?: string;
    upload?: (file: File) => Promise<string>;
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

  let dragOver = $state(false);

  /** Inserts a placeholder per file at the cursor, uploads, then swaps each placeholder for the result. */
  async function uploadFiles(files: File[]) {
    if (!upload || files.length === 0) return;
    const at = textarea?.selectionStart ?? value.length;
    const tokens = files.map((f) => `![Uploading ${f.name || 'file'}…]()`);
    const inserted = tokens.join('\n');
    value = `${value.slice(0, at)}${inserted}${value.slice(at)}`;
    await Promise.all(
      files.map(async (file, i) => {
        let markdown = '';
        try {
          markdown = await upload(file);
        } catch (e) {
          toast(`${file.name}: ${errorMessage(e)}`, 'error');
        }
        value = value.replace(tokens[i]!, markdown);
      }),
    );
  }

  function onpaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!upload || files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function ondrop(event: DragEvent) {
    dragOver = false;
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!upload || files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }
</script>

<div
  class="rounded-md border bg-bg focus-within:border-border-strong {dragOver
    ? 'border-accent'
    : 'border-border'}"
>
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
    <span class="ml-auto self-center text-fg-subtle"
      >Markdown{upload ? ' · paste or drop files' : ''} · ⌘↵ to save</span
    >
  </div>
  {#if tab === 'write'}
    <textarea
      bind:this={textarea}
      bind:value
      {rows}
      {placeholder}
      {onkeydown}
      {onpaste}
      {ondrop}
      ondragover={(e) => {
        if (upload && e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          dragOver = true;
        }
      }}
      ondragleave={() => (dragOver = false)}
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
