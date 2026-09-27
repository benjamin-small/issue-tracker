<script lang="ts">
  import { input } from '../styles.ts';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { api, call, errorMessage } from '../api.ts';
  import { fetchers, keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';

  /** Project name and description. The key is fixed: every issue ID is built from it. */
  let { projectKey }: { projectKey: string } = $props();
  const qc = useQueryClient();
  const project = createQuery(() => ({
    queryKey: keys.project(projectKey),
    queryFn: () => fetchers.project(projectKey),
  }));

  async function save(body: { name?: string; description?: string }) {
    const current = project.data;
    if (!current) return;
    if (body.name !== undefined && (!body.name.trim() || body.name === current.name)) return;
    if (body.description !== undefined && body.description === current.description) return;
    try {
      await call(
        api.PATCH('/projects/{project}', { params: { path: { project: projectKey } }, body }),
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.project(projectKey) }),
        qc.invalidateQueries({ queryKey: keys.projects }),
      ]);
      toast('Saved', 'success');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
</script>

<section data-testid="settings-general">
  <h2 class="mb-3 font-medium">General</h2>
  {#if project.data}
    <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-fg-muted">Name</span>
        <input
          class="{input} w-full"
          value={project.data.name}
          aria-label="Project name"
          onchange={(e) => save({ name: e.currentTarget.value.trim() })}
        />
      </label>
      <div>
        <span class="mb-1 block text-xs font-medium text-fg-muted">Key</span>
        <p
          class="rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-sm text-fg-muted"
          title="Issue IDs are built from the key, so it can't change."
        >
          {project.data.key}
        </p>
      </div>
      <label class="block sm:col-span-2">
        <span class="mb-1 block text-xs font-medium text-fg-muted">Description</span>
        <textarea
          class="{input} w-full resize-y"
          rows="2"
          value={project.data.description}
          placeholder="What this project covers"
          aria-label="Project description"
          onchange={(e) => save({ description: e.currentTarget.value })}></textarea>
      </label>
    </div>
  {/if}
</section>
