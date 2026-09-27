<script lang="ts">
  import { Dialog } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import { ui } from '../ui.svelte.ts';
  import Kbd from './Kbd.svelte';

  const mod =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
  const groups: Array<{ title: string; keys: Array<[string[], string]> }> = [
    {
      title: 'General',
      keys: [
        [[mod, 'K'], 'Command menu'],
        [['C'], 'New issue'],
        [['/'], 'Search this view'],
        [['?'], 'Show shortcuts'],
      ],
    },
    {
      title: 'Go to',
      keys: [
        [['G', 'I'], 'Issues'],
        [['G', 'B'], 'Board'],
        [['G', 'S'], 'Project settings'],
      ],
    },
    {
      title: 'Lists and boards',
      keys: [
        [['J'], 'Next issue'],
        [['K'], 'Previous issue'],
        [['↵'], 'Open focused issue'],
        [['X'], 'Select or deselect'],
        [['Shift', 'click'], 'Select a range'],
        [['Esc'], 'Clear selection / close panel'],
      ],
    },
    {
      title: 'Focused, selected or open issues',
      keys: [
        [['S'], 'Change status'],
        [['A'], 'Assign'],
        [['P'], 'Set priority'],
        [['L'], 'Labels'],
        [['1'], 'Priority: urgent … 4 low, 0 none'],
        [[mod, '⌫'], 'Move to trash (with undo)'],
      ],
    },
  ];
</script>

<Dialog.Root bind:open={ui.shortcutsOpen}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
    <Dialog.Content
      class="fixed top-[10vh] left-1/2 z-50 max-h-[80vh] w-[min(640px,94vw)] -translate-x-1/2 overflow-y-auto rounded-xl border border-border bg-bg shadow-2xl"
      data-testid="shortcuts-dialog"
    >
      <div class="flex items-center border-b border-border px-4 py-3">
        <Dialog.Title class="font-semibold">Keyboard shortcuts</Dialog.Title>
        <Dialog.Close class="ml-auto rounded p-1 hover:bg-bg-hover" aria-label="Close"
          ><X size={15} /></Dialog.Close
        >
      </div>
      <div class="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
        {#each groups as group (group.title)}
          <section>
            <h3 class="mb-2 text-xs font-medium text-fg-subtle">{group.title}</h3>
            <dl class="space-y-1.5 text-sm">
              {#each group.keys as [combo, what] (what)}
                <div class="flex items-center gap-3">
                  <dt class="flex shrink-0 gap-1">
                    {#each combo as k (k)}<Kbd>{k}</Kbd>{/each}
                  </dt>
                  <dd class="text-fg-muted">{what}</dd>
                </div>
              {/each}
            </dl>
          </section>
        {/each}
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
