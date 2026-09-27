<script lang="ts" module>
  /** Suggested colours for statuses and labels. */
  export const PALETTE = [
    '#6b7280',
    '#ef4444',
    '#f97316',
    '#f59e0b',
    '#eab308',
    '#84cc16',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#5e6ad2',
    '#8b5cf6',
    '#d946ef',
    '#ec4899',
    '#78716c',
    '#0f172a',
  ];
</script>

<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import { Popover } from 'bits-ui';

  /** Swatch button that opens a palette plus a hex field. Replaces the native colour input. */
  let {
    value,
    onchange,
    label,
    testid,
    compact = false,
  }: {
    value: string;
    onchange: (color: string) => void;
    label: string;
    testid?: string;
    /** Just the swatch, for use inside chips. */
    compact?: boolean;
  } = $props();

  let open = $state(false);
  let hex = $state('');
  $effect(() => {
    if (open) hex = value;
  });
  const valid = (v: string) => /^#[0-9a-f]{6}$/i.test(v);

  function pick(color: string) {
    open = false;
    if (color.toLowerCase() !== value.toLowerCase()) onchange(color.toLowerCase());
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    class="inline-flex shrink-0 items-center justify-center rounded-md {compact
      ? 'size-4 rounded-full'
      : 'size-8 border border-border bg-bg hover:bg-bg-hover focus-visible:border-accent focus-visible:outline-none'}"
    aria-label={label}
    data-testid={testid}
  >
    <span class="rounded-full {compact ? 'size-3' : 'size-4'}" style:background={value}></span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={4}
      align="start"
      class="z-50 w-52 rounded-lg border border-border bg-bg p-2 shadow-lg"
    >
      <div class="grid grid-cols-8 gap-1">
        {#each PALETTE as color (color)}
          <button
            type="button"
            aria-pressed={color === value.toLowerCase()}
            aria-label={color}
            class="flex size-5 items-center justify-center rounded-full ring-offset-1 ring-offset-bg hover:ring-2 hover:ring-border-strong focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            style:background={color}
            onclick={() => pick(color)}
          >
            {#if color === value.toLowerCase()}<Check size={12} class="text-white" />{/if}
          </button>
        {/each}
      </div>
      <form
        class="mt-2 flex items-center gap-1.5"
        onsubmit={(e) => {
          e.preventDefault();
          if (valid(hex)) pick(hex);
        }}
      >
        <span
          class="size-5 shrink-0 rounded-full border border-border"
          style:background={valid(hex) ? hex : value}
        ></span>
        <input
          bind:value={hex}
          aria-label="Hex colour"
          maxlength="7"
          class="w-full rounded border px-1.5 py-0.5 font-mono text-xs outline-none {valid(hex)
            ? 'border-border focus:border-accent'
            : 'border-danger'}"
        />
      </form>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
