<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import Link from '@lucide/svelte/icons/link';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import X from '@lucide/svelte/icons/x';
  import { deleteIssue, projectKeyOf, restoreIssue, updateIssue } from '../issues.ts';
  import { useProjectData } from '../project-data.svelte.ts';
  import { fetchers, keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';
  import ActivityTimeline from './ActivityTimeline.svelte';
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
    await navigator.clipboard?.writeText(`${location.origin}/i/${issueKey}`).catch(() => {});
    toast(`Copied link to ${issueKey}`, 'success');
  }
</script>

{#if query.isError}
  <div class="p-8 text-sm text-fg-muted">
    Couldn't load {issueKey}: {query.error.message}
    {#if onclose}<button class="ml-2 text-accent" onclick={onclose}>Close</button>{/if}
  </div>
{:else if !issue}
  <div class="p-8 text-sm text-fg-subtle">Loading…</div>
{:else}
  <article class="flex h-full min-h-0 flex-col" data-testid="issue-detail" data-issue={issue.key}>
    <header class="flex items-center gap-2 border-b border-border px-4 py-2 text-sm">
      <a href="/p/{projectKeyOf(issue.key)}" class="text-fg-subtle hover:text-fg"
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
            aria-label="Delete issue"
            data-testid="delete-issue"
          >
            <Trash2 size={15} />
          </button>
        {/if}
        {#if panel}
          <a
            href="/i/{issue.key}"
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

    <div class="flex min-h-0 flex-1 {panel ? 'flex-col overflow-y-auto' : 'overflow-hidden'}">
      <div class="min-w-0 flex-1 space-y-6 px-6 py-5 {panel ? '' : 'overflow-y-auto'}">
        <input
          bind:value={title}
          onblur={saveTitle}
          onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          disabled={!!issue.deletedAt}
          aria-label="Title"
          data-testid="issue-title"
          class="w-full bg-transparent text-xl font-semibold outline-none"
        />

        <div>
          {#if editingDescription}
            <MarkdownEditor
              bind:value={description}
              rows={10}
              autofocus
              onsubmit={saveDescription}
              oncancel={() => (editingDescription = false)}
              testid="description-input"
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
        <ActivityTimeline {issue} me={me.data} />
      </div>

      <aside
        class="shrink-0 border-border px-4 py-4 {panel
          ? 'order-first border-b'
          : 'w-72 overflow-y-auto border-l'}"
      >
        <IssueProperties {issue} {project} />
      </aside>
    </div>
  </article>
{/if}
