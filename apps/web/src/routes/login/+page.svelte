<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { api, call, errorMessage } from '$lib/api.ts';
  import { fetchers, keys } from '$lib/queries.ts';
  import Avatar from '$components/Avatar.svelte';

  const qc = useQueryClient();
  const config = createQuery(() => ({ queryKey: keys.authConfig, queryFn: fetchers.authConfig }));
  let token = $state('');
  let error = $state('');
  let busy = $state(false);

  const next = $derived(page.url.searchParams.get('next') ?? '/');

  async function finish() {
    await qc.invalidateQueries();
    await goto(next.startsWith('/') && !next.startsWith('//') ? next : '/');
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
      <img src="/favicon.svg" alt="" class="size-7" />
      <h1 class="text-lg font-semibold">Sign in to Tracker</h1>
    </div>

    {#if config.data?.devLogin && config.data.users?.length}
      <p class="mb-2 text-xs font-medium tracking-wide text-fg-subtle uppercase">
        Development — pick a user
      </p>
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

    <form onsubmit={tokenLogin} class="space-y-3">
      <label class="block">
        <span class="mb-1 block text-xs font-medium text-fg-muted">API token</span>
        <input
          bind:value={token}
          type="password"
          autocomplete="off"
          placeholder="trk_…"
          class="w-full rounded-md border border-border bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !token.trim()}
        class="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
        >Sign in</button
      >
      <p class="text-xs text-fg-subtle">
        Create a token with <code class="font-mono">tracker token create --name web</code>.
      </p>
      {#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
    </form>
  </div>
</main>
