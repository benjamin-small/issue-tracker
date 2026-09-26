<script lang="ts">
  let { label }: { label: { name: string; color: string } } = $props();
</script>

<span
  class="inline-flex max-w-40 items-center gap-1 rounded-full border border-border px-1.5 py-px text-xs text-fg-muted"
>
  <span class="size-2 shrink-0 rounded-full" style:background={label.color}></span>
  <span class="truncate">{label.name}</span>
</span>
