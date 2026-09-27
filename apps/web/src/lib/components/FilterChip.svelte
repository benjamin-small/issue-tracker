<script lang="ts" generics="T extends PickerItem">
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import type { Snippet } from 'svelte';
  import Picker, { type PickerItem } from './Picker.svelte';

  /**
   * One quick filter. Inactive, it is a dashed "+ Status" button; active, it reads
   * "Status | is | In Progress, Todo | ×", where "is"/"is not" toggles and the values reopen the picker.
   */
  let {
    label,
    plural,
    items,
    values,
    negated,
    ontoggle,
    onnegate,
    onclear,
    item,
    testid,
  }: {
    label: string;
    /** "statuses", for "3 statuses". */
    plural: string;
    items: T[];
    values: string[];
    negated: boolean;
    ontoggle: (value: string) => void;
    onnegate: () => void;
    onclear: () => void;
    item: Snippet<[T]>;
    testid: string;
  } = $props();

  const active = $derived(values.length > 0);
  const chosen = $derived(items.filter((i) => values.includes(i.value)));
  const summary = $derived(
    chosen.length === 0
      ? ''
      : chosen.length <= 2
        ? chosen.map((i) => i.label).join(', ')
        : `${chosen.length} ${plural}`,
  );
</script>

<!-- One Picker instance in both states, so choosing the first value keeps the menu open for more. -->
<span
  class="inline-flex shrink-0 items-center overflow-hidden rounded-md border text-xs {active
    ? 'border-accent/30 bg-accent-subtle'
    : 'border-dashed border-border text-fg-muted hover:border-border-strong hover:text-fg'}"
  data-testid={active ? `${testid}-active` : undefined}
>
  {#if active}
    <span class="py-1 pr-1 pl-2 text-fg-muted">{label}</span>
    <button
      class="px-1 py-1 font-medium text-fg-muted hover:bg-accent/10 hover:text-fg"
      onclick={onnegate}
      aria-label="{label}: switch to {negated ? 'is' : 'is not'}"
      title="Switch between is and is not"
      data-testid="{testid}-op">{negated ? 'is not' : 'is'}</button
    >
  {/if}
  <Picker
    {items}
    selected={values}
    multiple
    onselect={ontoggle}
    triggerLabel={active
      ? `Change ${label.toLowerCase()} filter`
      : `Filter by ${label.toLowerCase()}`}
    triggerClass="rounded-none py-1 {active ? 'font-medium text-fg hover:bg-accent/10' : ''}"
    {testid}
    {item}
  >
    {#snippet trigger()}
      {#if active}<span class="max-w-40 truncate">{summary}</span>{:else}<Plus
          size={12}
        />{label}{/if}
    {/snippet}
  </Picker>
  {#if active}
    <button
      class="self-stretch px-1.5 text-fg-muted hover:bg-accent/10 hover:text-fg"
      aria-label="Remove {label.toLowerCase()} filter"
      onclick={onclear}><X size={12} /></button
    >
  {/if}
</span>
