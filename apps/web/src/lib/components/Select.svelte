<script lang="ts" module>
  export interface SelectItem {
    value: string;
    label: string;
    /** Optional secondary text shown after the label in the menu. */
    hint?: string;
  }
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import { Select } from 'bits-ui';

  /** The app's dropdown: same look as the pickers, keyboard friendly, replaces native `<select>`. */
  let {
    value,
    items,
    onchange,
    label,
    placeholder = 'Select…',
    testid,
    class: className = '',
    size = 'md',
  }: {
    value: string;
    items: SelectItem[];
    onchange: (value: string) => void;
    /** Accessible name of the control. */
    label: string;
    placeholder?: string;
    testid?: string;
    class?: string;
    size?: 'sm' | 'md';
  } = $props();

  const selected = $derived(items.find((i) => i.value === value));
</script>

<Select.Root
  type="single"
  {value}
  onValueChange={(v) => v !== value && onchange(v)}
  items={items.map((i) => ({ value: i.value, label: i.label }))}
>
  <Select.Trigger
    aria-label={label}
    data-testid={testid}
    class="inline-flex min-w-0 items-center justify-between gap-1.5 rounded-md border border-border bg-bg text-left outline-none hover:bg-bg-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent {size ===
    'sm'
      ? 'px-2 py-1 text-xs'
      : 'px-2.5 py-1.5 text-sm'} {className}"
  >
    <span class="truncate {selected ? '' : 'text-fg-subtle'}">{selected?.label ?? placeholder}</span
    >
    <ChevronDown size={14} class="shrink-0 text-fg-subtle" />
  </Select.Trigger>
  <Select.Portal>
    <Select.Content
      sideOffset={4}
      class="z-50 max-h-72 min-w-(--bits-select-anchor-width) overflow-hidden rounded-lg border border-border bg-bg p-1 shadow-lg"
    >
      <Select.Viewport>
        {#each items as item (item.value)}
          <Select.Item
            value={item.value}
            label={item.label}
            class="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-highlighted:bg-bg-hover"
          >
            {#snippet children({ selected: isSelected })}
              <span class="truncate">{item.label}</span>
              {#if item.hint}<span class="truncate text-xs text-fg-subtle">{item.hint}</span>{/if}
              {#if isSelected}<Check size={14} class="ml-auto shrink-0 text-accent" />{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
