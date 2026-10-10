<script lang="ts">
  import { btn, input } from '../styles.ts';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { api, call, errorMessage, type Project } from '../api.ts';
  import { fetchers, keys } from '../queries.ts';
  import { confirmAction } from '../confirm.svelte.ts';
  import { toast } from '../toast.svelte.ts';

  /** The GitHub repositories an issue of this project can name. */
  let { projectKey }: { projectKey: string } = $props();
  const qc = useQueryClient();
  const project = createQuery(() => ({
    queryKey: keys.project(projectKey),
    queryFn: () => fetchers.project(projectKey),
  }));

  async function run<T>(
    action: Promise<T>,
    saved: string,
    refresh: ReadonlyArray<readonly unknown[]> = [],
  ): Promise<T | undefined> {
    try {
      const result = await action;
      await Promise.all(
        [keys.project(projectKey), keys.projects, ...refresh].map((queryKey) =>
          qc.invalidateQueries({ queryKey }),
        ),
      );
      toast(saved, 'success');
      return result;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return undefined;
    }
  }

  let repo = $state('');
  async function link(event: SubmitEvent) {
    event.preventDefault();
    const value = repo.trim();
    if (!value) return;
    const linked = await run(
      call(
        api.POST('/projects/{project}/repos', {
          params: { path: { project: projectKey } },
          body: { repo: value },
        }),
      ),
      'Repository linked',
    );
    if (linked) repo = '';
  }

  async function unlink(r: Project['repos'][number]) {
    const ok = await confirmAction({
      title: `Unlink ${r.fullName}?`,
      body: 'Issues linked to it lose the link.',
      confirmLabel: 'Unlink repository',
      danger: true,
    });
    if (!ok) return;
    await run(
      call(
        api.DELETE('/projects/{project}/repos/{repo}', {
          params: { path: { project: projectKey, repo: r.id } },
        }),
      ),
      `Unlinked ${r.fullName}`,
      // Issues that named the repo lose the link: lists and any cached issue pages.
      [keys.issueLists(projectKey), ['issue']],
    );
  }
</script>

<section data-testid="settings-repos">
  <h2 class="mb-1 font-medium">Repositories</h2>
  <p class="mb-3 text-sm text-fg-muted">
    GitHub repositories that issues in this project can name.
  </p>
  <ul class="divide-y divide-border rounded-lg border border-border">
    {#each project.data?.repos ?? [] as r (r.id)}
      <li class="flex items-center gap-2 px-3 py-2" data-repo={r.fullName}>
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          class="min-w-0 flex-1 truncate text-sm text-accent hover:underline">{r.fullName}</a
        >
        <button
          class="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-danger"
          aria-label="Unlink {r.fullName}"
          title="Unlink repository"
          onclick={() => unlink(r)}><Trash2 size={14} /></button
        >
      </li>
    {:else}
      <li class="px-3 py-3 text-sm text-fg-subtle">No repositories linked yet.</li>
    {/each}
  </ul>
  <form class="mt-3 flex gap-2" onsubmit={link}>
    <input
      class="{input} min-w-0 flex-1"
      placeholder="owner/name or GitHub URL"
      aria-label="Repository to link"
      bind:value={repo}
    />
    <button class={btn.primary} disabled={!repo.trim()}>Link repository</button>
  </form>
</section>
