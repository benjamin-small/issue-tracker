<script lang="ts">
  import '../app.css';
  import { current, navigate, signInPath } from '$lib/nav.ts';
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
    if (current().path !== '/login') {
      queryClient.clear();
      void navigate(signInPath());
    }
  });
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
  <Toaster />
</QueryClientProvider>
