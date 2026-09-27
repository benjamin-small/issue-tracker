<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import Link from '@lucide/svelte/icons/link';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import FileQuestion from '@lucide/svelte/icons/file-question';
  import X from '@lucide/svelte/icons/x';
  import { MediaQuery } from 'svelte/reactivity';
  import { ApiError } from '../api.ts';
  import { href, shareUrl } from '../nav.ts';
  import { deleteIssue, projectKeyOf, restoreIssue, updateIssue } from '../issues.ts';
  import { useProjectData } from '../project-data.svelte.ts';
  import { fetchers, keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';
  import { ui } from '../ui.svelte.ts';
  import { markdownUploader } from '../attachments.ts';
  import { autosize } from '../autosize.ts';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import AttachmentsSection from './AttachmentsSection.svelte';
  import CustomFieldEditor from './CustomFieldEditor.svelte';
  import EmptyState from './EmptyState.svelte';
  import IssueProperties from './IssueProperties.svelte';
  import LinksSection from './LinksSection.svelte';
  import Markdown from './Markdown.svelte';
  import MarkdownEditor from './MarkdownEditor.svelte';
  import SubIssues from './SubIssues.svelte';

  /** Full issue view, used as a page (`/i/ENG-42`) and as the peek panel over lists and boards. */
  let {
    issueKey,
    onopen,
    onclose,
    panel = false,
  }: {
    issueKey: string;
    onopen: (key: string) => void;
    onclose?: () => void;
    panel?: boolean;
  } = $props();

  const qc = useQueryClient();
  const query = createQuery(() => ({
    queryKey: keys.issue(issueKey),
    queryFn: () => fetchers.issue(issueKey),
  }));
  const me = createQuery(() => ({ queryKey: keys.me, queryFn: fetchers.me, staleTime: 300_000 }));
  const project = useProjectData(() => projectKeyOf(issueKey));
  const issue = $derived(query.data);
  const upload = markdownUploader(qc, () => issueKey);

  // Side-by-side properties only on a wide full page; the panel and narrow screens stack them under the title.
  const wide = new MediaQuery('min-width: 1024px');
  const stacked = $derived(panel || !wide.current);
  // While shown, this issue is what issue shortcuts (s, a, p, l, ⌘⌫) act on.
  $effect(() => {
    const key = issueKey;
    ui.openIssue = key;
    return () => {
      if (ui.openIssue === key) ui.openIssue = null;
    };
  });
  const notFound = $derived(query.error instanceof ApiError && query.error.status === 404);

  let title = $state('');
  let editingDescription = $state(false);
  let description = $state('');

  $effect(() => {
    if (issue) title = issue.title;
  });

  function saveTitle() {
    if (!issue || !title.trim() || title.trim() === issue.title)
      return void (title = issue?.title ?? title);
    void updateIssue(qc, issue, { title: title.trim() }, { title: title.trim() });
  }

  async function saveDescription() {
    if (!issue) return;
    editingDescription = false;
    if (description !== issue.description)
      await updateIssue(qc, issue, { description }, { description });
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(shareUrl(`/i/${issueKey}`)).catch(() => {});
    toast(`Copied link to ${issueKey}`, 'success');
  }
</script>

{#if query.isError}
  <EmptyState
    icon={FileQuestion}
    title={notFound ? `${issueKey} doesn’t exist` : `Couldn’t load ${issueKey}`}
    testid="issue-error"
  >
    {notFound
      ? 'It may have been deleted permanently, or the key may be mistyped.'
      : query.error.message}
    {#snippet actions()}
      {#if onclose}
        <button
          class="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-bg-hover"
          onclick={onclose}>Close</button
        >
      {/if}
      <a
        href={href(`/p/${projectKeyOf(issueKey)}`)}
        class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg"
        >Back to {projectKeyOf(issueKey)} issues</a
      >
    {/snippet}
  </EmptyState>
{:else if !issue}
  <div class="space-y-3 p-6" aria-busy="true" aria-label="Loading issue">
    <div class="h-6 w-2/3 animate-pulse rounded bg-bg-muted"></div>
    <div class="h-4 w-full animate-pulse rounded bg-bg-muted"></div>
    <div class="h-4 w-5/6 animate-pulse rounded bg-bg-muted"></div>
  </div>
{:else}
  <article class="flex h-full min-h-0 flex-col" data-testid="issue-detail" data-issue={issue.key}>
    <header class="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
      <a href={href(`/p/${projectKeyOf(issue.key)}`)} class="text-fg-subtle hover:text-fg"
        >{projectKeyOf(issue.key)}</a
      >
      <span class="text-fg-subtle">›</span>
      {#if issue.parent}
        <button
          class="truncate text-fg-subtle hover:text-fg"
          onclick={() => onopen(issue.parent!.key)}>{issue.parent.key}</button
        >
        <span class="text-fg-subtle">›</span>
      {/if}
      <span class="font-mono text-fg-muted">{issue.key}</span>
      <span class="ml-auto flex items-center gap-1 text-fg-subtle">
        <button
          class="rounded p-1 hover:bg-bg-hover hover:text-fg"
          onclick={copyLink}
          title="Copy link"
          aria-label="Copy link"><Link size={15} /></button
        >
        {#if issue.deletedAt}
          <button
            class="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-hover hover:text-fg"
            onclick={() => restoreIssue(qc, issue)}
            data-testid="restore-issue"
          >
            <RotateCcw size={14} /> Restore
          </button>
        {:else}
          <button
            class="rounded p-1 hover:bg-bg-hover hover:text-danger"
            onclick={() => deleteIssue(qc, issue)}
            title="Move to trash ({/Mac|iPhone|iPad/.test(navigator.platform)
              ? '⌘'
              : 'Ctrl'}⌫). You can undo."
            aria-label="Delete issue"
            data-testid="delete-issue"
          >
            <Trash2 size={15} />
          </button>
        {/if}
        {#if panel}
          <a
            href={href(`/i/${issue.key}`)}
            class="rounded p-1 hover:bg-bg-hover hover:text-fg"
            aria-label="Open full page"><Maximize2 size={15} /></a
          >
        {/if}
        {#if onclose}
          <button
            class="rounded p-1 hover:bg-bg-hover hover:text-fg"
            onclick={onclose}
            aria-label="Close"><X size={15} /></button
          >
        {/if}
      </span>
    </header>

    {#if issue.deletedAt}
      <div
        class="border-b border-border bg-bg-muted px-4 py-2 text-sm text-fg-muted"
        data-testid="deleted-banner"
      >
        This issue is in the trash. Restore it to make changes.
      </div>
    {/if}

    <div class="flex min-h-0 flex-1 overflow-hidden">
      <div class="min-w-0 flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
        <textarea
          bind:value={title}
          onblur={saveTitle}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          disabled={!!issue.deletedAt}
          aria-label="Title"
          data-testid="issue-title"
          use:autosize={title}
          rows="1"
          class="w-full resize-none bg-transparent text-xl leading-snug font-semibold text-balance outline-none [field-sizing:content]"
        ></textarea>
        {#if stacked}
          <div class="rounded-lg border border-border px-3 py-2">
            {@render properties()}
          </div>
        {/if}

        <div>
          {#if editingDescription}
            <MarkdownEditor
              bind:value={description}
              rows={10}
              autofocus
              onsubmit={saveDescription}
              oncancel={() => (editingDescription = false)}
              testid="description-input"
              {upload}
            />
            <div class="mt-2 flex justify-end gap-2 text-sm">
              <button
                class="rounded px-2 py-1 hover:bg-bg-hover"
                onclick={() => (editingDescription = false)}>Cancel</button
              >
              <button
                class="rounded bg-accent px-3 py-1 text-accent-fg"
                onclick={saveDescription}
                data-testid="description-save">Save</button
              >
            </div>
          {:else}
            <button
              class="block w-full rounded-md text-left hover:bg-bg-subtle disabled:hover:bg-transparent"
              disabled={!!issue.deletedAt}
              onclick={() => ((description = issue.description), (editingDescription = true))}
              data-testid="description"
            >
              {#if issue.description.trim()}<Markdown source={issue.description} />{:else}<p
                  class="py-1 text-sm text-fg-subtle"
                >
                  Add a description…
                </p>{/if}
            </button>
          {/if}
        </div>

        <SubIssues {issue} {onopen} />
        <LinksSection {issue} {onopen} />
        <AttachmentsSection {issue} />
        <ActivityTimeline {issue} me={me.data} />
      </div>

      {#if !stacked}
        <aside class="w-72 shrink-0 overflow-y-auto border-l border-border px-4 py-4">
          {@render properties()}
        </aside>
      {/if}
    </div>
  </article>
{/if}

{#snippet properties()}
  {#if issue}
    <IssueProperties {issue} {project}>
      {#snippet extra()}
        {#each project.customFields as field (field.id)}
          <div class="grid grid-cols-[88px_1fr] items-center gap-2 py-0.5">
            <span class="truncate text-xs text-fg-subtle" title={field.description || field.name}
              >{field.name}</span
            >
            <div class="min-w-0">
              <CustomFieldEditor {issue} {field} users={project.users} />
            </div>
          </div>
        {/each}
      {/snippet}
    </IssueProperties>
  {/if}
{/snippet}
