<script lang="ts">
  import { btn, input } from '$lib/styles.ts';
  import { asset } from '$app/paths';
  import { current, navigate } from '$lib/nav.ts';

  const DEMO = import.meta.env.TRACKER_DEMO;
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { api, call, errorMessage } from '$lib/api.ts';
  import { fetchers, keys } from '$lib/queries.ts';
  import Avatar from '$components/Avatar.svelte';

  const qc = useQueryClient();
  const config = createQuery(() => ({ queryKey: keys.authConfig, queryFn: fetchers.authConfig }));
  let token = $state('');
  let error = $state('');
  let busy = $state(false);

  const next = $derived(current().params.get('next') ?? '/');

  async function finish() {
    await qc.invalidateQueries();
    await navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/');
  }

  async function tokenLogin(event: SubmitEvent) {
    event.preventDefault();
    busy = true;
    error = '';
    try {
      await call(api.POST('/auth/token-login', { body: { token: token.trim() } }));
      await finish();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  async function devLogin(user: string) {
    busy = true;
    try {
      await call(api.POST('/auth/dev-login', { body: { user } }));
      await finish();
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sign in · Tracker</title></svelte:head>

<main class="flex min-h-screen items-center justify-center bg-bg-subtle p-6">
  <div class="w-full max-w-sm rounded-xl border border-border bg-bg p-6 shadow-sm">
    <div class="mb-6 flex items-center gap-2">
      <img src={asset('/favicon.svg')} alt="" class="size-7" />
      <h1 class="text-lg font-semibold">Sign in to Tracker</h1>
    </div>

    {#if config.data?.devLogin && config.data.users?.length}
      <p class="mb-1 text-sm font-medium">{DEMO ? 'Explore as…' : 'Continue as…'}</p>
      {#if !DEMO}
        <p class="mb-2 text-xs text-fg-subtle">
          This server runs with <code class="font-mono">TRACKER_AUTH_MODE=dev</code>, so anyone can
          pick a user. Use <code class="font-mono">standard</code> in production.
        </p>
      {/if}
      <ul class="mb-6 space-y-1" data-testid="dev-users">
        {#each config.data.users as u (u.id)}
          <li>
            <button
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-hover disabled:opacity-50"
              disabled={busy}
              onclick={() => devLogin(u.handle)}
            >
              <Avatar user={u} size={22} />
              <span class="font-medium">{u.name}</span>
              <span class="text-fg-subtle">@{u.handle}</span>
              {#if u.kind === 'agent'}<span
                  class="ml-auto rounded bg-bg-muted px-1.5 text-xs text-fg-muted">agent</span
                >{/if}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if DEMO}
      <p class="text-xs text-fg-subtle">
        This demo runs entirely in your browser, including the API and its SQLite database. Changes
        stay on this device. To start over, use Reset data at the bottom right.
      </p>
    {:else}
      <form onsubmit={tokenLogin} class="space-y-3">
        {#if config.data?.devLogin && config.data.users?.length}
          <div class="flex items-center gap-2 text-xs text-fg-subtle" aria-hidden="true">
            <span class="h-px flex-1 bg-border"></span>or use a token<span
              class="h-px flex-1 bg-border"
            ></span>
          </div>
        {/if}
        <label class="block">
          <span class="mb-1 block text-xs font-medium text-fg-muted">API token</span>
          <input
            bind:value={token}
            type="password"
            autocomplete="off"
            placeholder="trk_…"
            class="{input} w-full font-mono"
          />
        </label>
        <button type="submit" disabled={busy || !token.trim()} class="{btn.primary} w-full"
          >Sign in</button
        >
        <p class="text-xs text-fg-subtle">
          Ask an admin for a token, or create one with
          <code class="font-mono">tracker token create --name web</code>.
        </p>
      </form>
    {/if}
    {#if error}<p class="mt-3 text-sm text-danger" role="alert">{error}</p>{/if}
  </div>
</main>
