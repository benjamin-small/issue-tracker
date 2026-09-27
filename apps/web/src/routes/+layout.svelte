<script lang="ts">
  import '../app.css';
  import { current, navigate } from '$lib/nav.ts';
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
    const { path, params } = current();
    if (path !== '/login') {
      queryClient.clear();
      const query = params.toString();
      void navigate(`/login?next=${encodeURIComponent(query ? `${path}?${query}` : path)}`);
    }
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
  <Toaster />
</QueryClientProvider>
