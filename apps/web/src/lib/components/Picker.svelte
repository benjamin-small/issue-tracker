<script lang="ts" module>
  export interface PickerItem {
    value: string;
    label: string;
    keywords?: string[];
  }
</script>

<script lang="ts" generics="T extends PickerItem">
  import Check from '@lucide/svelte/icons/check';
  import { Command, Popover } from 'bits-ui';
  import type { Snippet } from 'svelte';

  /**
   * Searchable single/multi-select popover (keyboard friendly). The trigger is supplied by the caller;
   * `item` renders an option (defaults to its label). `readonly` shows just the trigger's content, as text.
   */
  let {
    items,
    selected,
    multiple = false,
    placeholder = 'Search…',
    onselect,
    trigger,
    item,
    triggerClass = '',
    triggerLabel,
    testid,
    readonly = false,
  }: {
    items: T[];
    selected: string[];
    multiple?: boolean;
    placeholder?: string;
    onselect: (value: string) => void;
    trigger: Snippet;
    item?: Snippet<[T]>;
    triggerClass?: string;
    triggerLabel: string;
    testid?: string;
    readonly?: boolean;
  } = $props();

  let open = $state(false);
</script>

{#if readonly}
  <span
    class="inline-flex min-w-0 items-center gap-1.5 px-1.5 py-1 {triggerClass}"
    data-testid={testid}
    data-readonly="true">{@render trigger()}</span
  >
{:else}
  <Popover.Root bind:open>
    <Popover.Trigger
      class="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-bg-hover {triggerClass}"
      aria-label={triggerLabel}
      data-testid={testid}
    >
      {@render trigger()}
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content
        sideOffset={4}
        align="start"
        class="z-50 w-60 overflow-hidden rounded-lg border border-border bg-bg shadow-lg"
      >
        <Command.Root>
          <Command.Input
            {placeholder}
            class="w-full border-b border-border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-fg-subtle"
          />
          <Command.List class="max-h-64 overflow-y-auto p-1">
            <Command.Empty class="px-2 py-3 text-center text-xs text-fg-subtle"
              >No matches</Command.Empty
            >
            {#each items as it (it.value)}
              <Command.Item
                value={it.value}
                keywords={[it.label, ...(it.keywords ?? [])]}
                onSelect={() => {
                  onselect(it.value);
                  if (!multiple) open = false;
                }}
                class="flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm data-selected:bg-bg-hover"
              >
                {#if item}{@render item(it)}{:else}<span class="truncate">{it.label}</span>{/if}
                {#if selected.includes(it.value)}<Check
                    size={14}
                    class="ml-auto shrink-0 text-accent"
                  />{/if}
              </Command.Item>
            {/each}
          </Command.List>
        </Command.Root>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
{/if}
