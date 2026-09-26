<script lang="ts">
  import type { GroupHeaderSpec } from '../grouping.ts';
  import Avatar from './Avatar.svelte';
  import PriorityIcon from './PriorityIcon.svelte';
  import StatusIcon from './StatusIcon.svelte';

  let { spec }: { spec: GroupHeaderSpec } = $props();
</script>

<span class="inline-flex items-center gap-2 font-medium">
  {#if spec.kind === 'status'}<StatusIcon category={spec.category} color={spec.color} />
  {:else if spec.kind === 'priority'}<PriorityIcon priority={spec.priority} />
  {:else if spec.kind === 'user'}<Avatar user={spec.user} size={16} />
  {:else if spec.kind === 'option'}<span class="size-2.5 rounded-full" style:background={spec.color}
    ></span>{/if}
  {spec.label}
</span>
