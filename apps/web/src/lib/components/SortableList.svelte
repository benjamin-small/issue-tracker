<script lang="ts" generics="T extends { id: string }">
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import { untrack } from 'svelte';
  import { dragHandle, dragHandleZone, type DndEvent, TRIGGERS } from 'svelte-dnd-action';

  /**
   * A list reordered by dragging a grip handle (or with the keyboard: focus the grip, Space, arrows,
   * Space). `onreorder` gets the new id order once the drop lands.
   */
  let {
    items,
    onreorder,
    row,
    label,
    class: className = '',
    itemClass = '',
    testid,
  }: {
    items: T[];
    onreorder: (ids: string[]) => void;
    row: Snippet<[T]>;
    /** Accessible name for an item's handle ("Reorder In Progress"). */
    label: (item: T) => string;
    class?: string;
    itemClass?: string;
    testid?: string;
  } = $props();

  const FLIP_MS = 120;
  let local = $state<T[]>([]);
  let dragging = $state(false);
  // Follow `items` when they change (after a save or a live update), but never mid-drag. Reading
  // `dragging` untracked keeps the dropped order on screen until the new `items` arrive.
  $effect(() => {
    const next = items;
    if (!untrack(() => dragging)) local = [...next];
  });

  function onconsider(event: CustomEvent<DndEvent<T>>) {
    // Keyboard drags send one last `consider` (dragStopped) after `finalize`.
    dragging = event.detail.info.trigger !== TRIGGERS.DRAG_STOPPED;
    local = event.detail.items;
  }
  function onfinalize(event: CustomEvent<DndEvent<T>>) {
    local = event.detail.items;
    dragging = false;
    const ids = local.map((i) => i.id);
    if (ids.join() !== items.map((i) => i.id).join()) onreorder(ids);
  }
</script>

<ul
  class={className}
  data-testid={testid}
  use:dragHandleZone={{ items: local, flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
  {onconsider}
  {onfinalize}
>
  {#each local as item (item.id)}
    <li class="flex items-center gap-1.5 {itemClass}" animate:flip={{ duration: FLIP_MS }}>
      <span
        use:dragHandle
        aria-label={label(item)}
        class="shrink-0 cursor-grab rounded p-0.5 text-fg-subtle hover:bg-bg-hover hover:text-fg active:cursor-grabbing"
        data-testid="drag-handle"><GripVertical size={14} /></span
      >
      {@render row(item)}
    </li>
  {/each}
</ul>
