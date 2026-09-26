<script lang="ts">
  import '../app.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import { ApiError, setUnauthenticatedHandler } from '$lib/api.ts';
  import Toaster from '$components/Toaster.svelte';

  let { children } = $props();

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });

  setUnauthenticatedHandler(() => {
    if (page.url.pathname !== '/login') {
      queryClient.clear();
      void goto(`/login?next=${encodeURIComponent(page.url.pathname + page.url.search)}`);
    }
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
  <Toaster />
</QueryClientProvider>
