<script lang="ts">
  import { page } from '$app/state';
  import { navigate } from '$lib/nav.ts';
  import IssueDetail from '$components/IssueDetail.svelte';

  const issueKey = $derived(page.params.issueKey!.toUpperCase());
</script>

<svelte:head><title>{issueKey}</title></svelte:head>

{#key issueKey}
  <IssueDetail {issueKey} onopen={(key) => navigate(`/i/${key}`)} />
{/key}
