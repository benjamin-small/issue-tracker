<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import FileIcon from '@lucide/svelte/icons/file';
  import Paperclip from '@lucide/svelte/icons/paperclip';
  import X from '@lucide/svelte/icons/x';
  import { api, call, errorMessage, type Issue, uploadAttachment } from '../api.ts';
  import { formatBytes } from '../attachments.ts';
  import { relativeTime } from '../format.ts';
  import { fetchers, keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';

  /** Files attached to an issue: image thumbnails, download links, upload (picker or drop) and delete. */
  let { issue }: { issue: Issue } = $props();
  const qc = useQueryClient();
  const attachments = createQuery(() => ({
    queryKey: keys.attachments(issue.key),
    queryFn: () => fetchers.attachments(issue.key),
  }));

  let input = $state<HTMLInputElement>();
  let uploading = $state(0);
  let dragOver = $state(false);

  const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

  function refresh() {
    void qc.invalidateQueries({ queryKey: keys.attachments(issue.key) });
    void qc.invalidateQueries({ queryKey: keys.activity(issue.key) });
  }

  async function upload(files: File[]) {
    uploading += files.length;
    await Promise.all(
      files.map(async (file) => {
        try {
          await uploadAttachment(issue.key, file);
        } catch (e) {
          toast(`${file.name}: ${errorMessage(e)}`, 'error');
        } finally {
          uploading -= 1;
        }
      }),
    );
    refresh();
  }

  async function remove(id: string) {
    try {
      await call(api.DELETE('/attachments/{id}', { params: { path: { id } } }));
      refresh();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
</script>

<section
  data-testid="attachments"
  class="rounded-md {dragOver ? 'outline-2 outline-offset-4 outline-accent outline-dashed' : ''}"
  aria-label="Attachments"
  ondragover={(e) => {
    if (!issue.deletedAt && e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      dragOver = true;
    }
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={(e) => {
    dragOver = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length && !issue.deletedAt) {
      e.preventDefault();
      void upload(files);
    }
  }}
>
  <div class="mb-1 flex items-center">
    <h3 class="text-xs font-medium text-fg-subtle">
      Attachments{#if uploading}<span class="ml-1 font-normal">· uploading {uploading}…</span>{/if}
    </h3>
    {#if !issue.deletedAt}
      <button
        class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-hover"
        onclick={() => input?.click()}
        data-testid="add-attachment"><Paperclip size={12} /> Attach files</button
      >
      <input
        bind:this={input}
        type="file"
        multiple
        class="hidden"
        data-testid="attachment-input"
        onchange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          e.currentTarget.value = '';
          void upload(files);
        }}
      />
    {/if}
  </div>
  {#if (attachments.data ?? []).length}
    <ul class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
      {#each attachments.data ?? [] as file (file.id)}
        <li
          class="group relative overflow-hidden rounded-md border border-border"
          data-testid="attachment"
          data-filename={file.filename}
        >
          <a href={file.url} target="_blank" rel="noopener" class="block">
            {#if INLINE.has(file.contentType)}
              <img
                src={file.url}
                alt={file.filename}
                loading="lazy"
                class="h-20 w-full bg-bg-muted object-cover"
              />
            {:else}
              <div class="flex h-20 items-center justify-center bg-bg-muted text-fg-subtle">
                <FileIcon size={24} />
              </div>
            {/if}
            <div class="px-2 py-1">
              <p class="truncate text-xs" title={file.filename}>{file.filename}</p>
              <p class="text-[11px] text-fg-subtle">
                {formatBytes(file.size)} · {relativeTime(file.createdAt)}
              </p>
            </div>
          </a>
          {#if !issue.deletedAt}
            <button
              class="absolute top-1 right-1 rounded bg-bg/80 p-0.5 text-fg-muted opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100"
              aria-label="Delete {file.filename}"
              onclick={() => remove(file.id)}><X size={12} /></button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {:else if !issue.deletedAt}
    <p class="text-xs text-fg-subtle">Drop files here, or paste them into the description.</p>
  {/if}
</section>
