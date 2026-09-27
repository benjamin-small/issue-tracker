<script lang="ts">
  import { page } from '$app/state';
  import ProjectView from '$components/ProjectView.svelte';

  const key = $derived(page.params.key!.toUpperCase());
</script>

<svelte:head><title>{key} · Board</title></svelte:head>

{#key key}
  <ProjectView projectKey={key} layout="board" />
{/key}
