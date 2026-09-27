<script lang="ts">
  import { page } from '$app/state';
  import ProjectView from '$components/ProjectView.svelte';

  const key = $derived(page.params.key!.toUpperCase());
</script>

<svelte:head><title>{key} · Issues</title></svelte:head>

{#key key}
  <ProjectView projectKey={key} layout="list" />
{/key}
