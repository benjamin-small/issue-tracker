<script lang="ts">
  import { page } from '$app/state';
  import ProjectView from '$components/ProjectView.svelte';

  const key = $derived(page.params.key!.toUpperCase());
  const viewId = $derived(page.params.viewId!);
</script>

<svelte:head><title>{key} · View</title></svelte:head>

{#key `${key}/${viewId}`}
  <ProjectView projectKey={key} layout="list" {viewId} />
{/key}
