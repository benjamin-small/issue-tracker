<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { useQueryClient } from '@tanstack/svelte-query';
  import KanbanSquare from '@lucide/svelte/icons/square-kanban';
  import List from '@lucide/svelte/icons/list';
  import LogOut from '@lucide/svelte/icons/log-out';
  import Moon from '@lucide/svelte/icons/moon';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings from '@lucide/svelte/icons/settings';
  import Sun from '@lucide/svelte/icons/sun';
  import { api, type Project, type User } from '../api.ts';
  import { applyTheme } from '../theme.ts';
  import { openCreateIssue } from '../ui.svelte.ts';
  import Avatar from './Avatar.svelte';

  let { me, projects, currentProject }: { me: User; projects: Project[]; currentProject: string } =
    $props();
  const qc = useQueryClient();
  let dark = $state(document.documentElement.classList.contains('dark'));

  function toggleTheme() {
    dark = !dark;
    applyTheme(dark ? 'dark' : 'light');
  }

  async function logout() {
    await api.POST('/auth/logout');
    qc.clear();
    await goto('/login');
  }

  const path = $derived(page.url.pathname);
  const link = (active: boolean) =>
    `flex items-center gap-2 rounded-md px-2 py-1 text-sm ${active ? 'bg-bg-hover text-fg font-medium' : 'text-fg-muted hover:bg-bg-hover hover:text-fg'}`;
</script>

<nav class="flex w-56 shrink-0 flex-col border-r border-border bg-bg-subtle" aria-label="Main">
  <div class="flex items-center gap-2 px-3 py-3">
    <img src="/favicon.svg" alt="" class="size-5" />
    <span class="font-semibold">Tracker</span>
  </div>
  <div class="px-2 pb-2">
    <button
      class="flex w-full items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg-muted shadow-xs hover:text-fg disabled:opacity-50"
      disabled={!currentProject}
      onclick={() => openCreateIssue(currentProject)}
      data-testid="new-issue"
    >
      <Plus size={15} /> New issue
      <kbd class="ml-auto rounded border border-border px-1 font-mono text-[10px] text-fg-subtle"
        >C</kbd
      >
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2">
    <p class="px-2 pt-2 pb-1 text-xs font-medium text-fg-subtle">Projects</p>
    {#each projects as p (p.id)}
      <div class="mb-1">
        <a href="/p/{p.key}" class={link(false)} class:!text-fg={p.key === currentProject}>
          <span
            class="inline-flex size-5 items-center justify-center rounded bg-bg-muted font-mono text-[10px] font-semibold"
            >{p.key.slice(0, 3)}</span
          >
          <span class="truncate">{p.name}</span>
        </a>
        {#if p.key === currentProject}
          <div class="ml-4 border-l border-border pl-2">
            <a href="/p/{p.key}" class={link(path === `/p/${p.key}`)}><List size={14} /> Issues</a>
            <a
              href="/p/{p.key}/board"
              class={link(path === `/p/${p.key}/board`)}
              data-testid="nav-board"><KanbanSquare size={14} /> Board</a
            >
            <a href="/p/{p.key}/settings" class={link(path.startsWith(`/p/${p.key}/settings`))}
              ><Settings size={14} /> Settings</a
            >
          </div>
        {/if}
      </div>
    {:else}
      <p class="px-2 text-xs text-fg-subtle">
        No projects yet. Create one with <code>tracker project create</code>.
      </p>
    {/each}
  </div>

  <div class="flex items-center gap-2 border-t border-border px-3 py-2">
    <Avatar user={me} size={22} />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{me.name}</div>
      <div class="truncate text-xs text-fg-subtle">@{me.handle}</div>
    </div>
    <button
      class="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-fg"
      onclick={toggleTheme}
      aria-label="Toggle theme"
    >
      {#if dark}<Sun size={15} />{:else}<Moon size={15} />{/if}
    </button>
    <button
      class="rounded p-1 text-fg-subtle hover:bg-bg-hover hover:text-fg"
      onclick={logout}
      aria-label="Sign out"
      data-testid="logout"
    >
      <LogOut size={15} />
    </button>
  </div>
</nav>
