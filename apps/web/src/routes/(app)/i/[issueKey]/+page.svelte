<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import IssueDetail from '$components/IssueDetail.svelte';

  const issueKey = $derived(page.params.issueKey!.toUpperCase());
</script>

<svelte:head><title>{issueKey}</title></svelte:head>

{#key issueKey}
  <IssueDetail {issueKey} onopen={(key) => goto(`/i/${key}`)} />
{/key}
