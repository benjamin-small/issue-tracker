<script lang="ts">
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import Link2 from '@lucide/svelte/icons/link-2';
  import X from '@lucide/svelte/icons/x';
  import { api, call, errorMessage, type Issue } from '../api.ts';
  import { fetchers, keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';
  import StatusIcon from './StatusIcon.svelte';

  let { issue, onopen }: { issue: Issue; onopen: (key: string) => void } = $props();
  const qc = useQueryClient();
  const links = createQuery(() => ({
    queryKey: keys.links(issue.key),
    queryFn: () => fetchers.links(issue.key),
  }));

  const RELATIONS = [
    { value: 'blocks', label: 'blocks', type: 'blocks', direction: 'outward' },
    { value: 'blocked-by', label: 'is blocked by', type: 'blocks', direction: 'inward' },
    { value: 'relates', label: 'relates to', type: 'relates', direction: 'outward' },
    { value: 'duplicates', label: 'duplicates', type: 'duplicates', direction: 'outward' },
    { value: 'duplicated-by', label: 'is duplicated by', type: 'duplicates', direction: 'inward' },
  ] as const;

  let adding = $state(false);
  let relation = $state<(typeof RELATIONS)[number]['value']>('blocks');
  let target = $state('');
  let busy = $state(false);

  const grouped = $derived(
    Object.entries(
      (links.data ?? []).reduce<Record<string, typeof links.data & object>>((acc, l) => {
        (acc[l.label] ??= []).push(l);
        return acc;
      }, {}),
    ),
  );

  function refresh(otherKey?: string) {
    void qc.invalidateQueries({ queryKey: keys.links(issue.key) });
    if (otherKey) void qc.invalidateQueries({ queryKey: keys.links(otherKey) });
    void qc.invalidateQueries({ queryKey: keys.activity(issue.key) });
  }

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const rel = RELATIONS.find((r) => r.value === relation)!;
    busy = true;
    try {
      await call(
        api.POST('/issues/{issue}/links', {
          params: { path: { issue: issue.key } },
          body: { type: rel.type, target: target.trim(), direction: rel.direction },
        }),
      );
      refresh(target.trim().toUpperCase());
      target = '';
      adding = false;
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }

  async function remove(id: string, otherKey: string) {
    try {
      await api.DELETE('/links/{id}', { params: { path: { id } } });
      refresh(otherKey);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
</script>

<section data-testid="links">
  <div class="mb-2 flex items-center">
    <h3 class="text-sm font-semibold">Links</h3>
    <button
      class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-bg-hover"
      onclick={() => (adding = !adding)}
      data-testid="add-link"><Link2 size={12} /> Link issue</button
    >
  </div>
  {#if adding}
    <form onsubmit={add} class="mb-2 flex items-center gap-2 text-sm">
      <span class="font-mono text-xs text-fg-subtle">{issue.key}</span>
      <select
        bind:value={relation}
        class="rounded border border-border bg-bg px-1.5 py-1"
        aria-label="Relation"
      >
        {#each RELATIONS as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
      </select>
      <input
        bind:value={target}
        placeholder="ENG-7"
        aria-label="Target issue"
        data-testid="link-target"
        class="w-28 rounded border border-border bg-bg px-2 py-1 font-mono text-xs uppercase"
      />
      <button
        type="submit"
        disabled={!target.trim() || busy}
        class="rounded bg-accent px-2 py-1 text-xs text-accent-fg disabled:opacity-50">Link</button
      >
    </form>
  {/if}
  {#each grouped as [label, items] (label)}
    <p class="mt-2 mb-1 text-xs text-fg-subtle">{label}</p>
    <ul class="divide-y divide-border rounded-md border border-border">
      {#each items as l (l.id)}
        <li class="group flex items-center gap-2 px-2 py-1.5 text-sm">
          <button
            class="flex min-w-0 flex-1 items-center gap-2 text-left"
            onclick={() => onopen(l.issue.key)}
          >
            <StatusIcon category={l.issue.status.category} color={l.issue.status.color} />
            <span class="font-mono text-xs text-fg-subtle">{l.issue.key}</span>
            <span class="truncate">{l.issue.title}</span>
          </button>
          <button
            class="rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-danger focus:opacity-100"
            aria-label="Remove link"
            onclick={() => remove(l.id, l.issue.key)}><X size={13} /></button
          >
        </li>
      {/each}
    </ul>
  {:else}
    {#if links.data && !adding}
      <p class="text-sm text-fg-subtle">No linked issues.</p>
    {/if}
  {/each}
</section>
