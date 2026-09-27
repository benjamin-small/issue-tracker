<script lang="ts">
  import { AlertDialog } from 'bits-ui';
  import { confirmState, settleConfirm } from '../confirm.svelte.ts';
</script>

<AlertDialog.Root
  open={!!confirmState.request}
  onOpenChange={(open) => !open && settleConfirm(false)}
>
  <AlertDialog.Portal>
    <AlertDialog.Overlay class="fixed inset-0 z-50 bg-black/30" />
    <AlertDialog.Content
      class="fixed top-[20vh] left-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 rounded-xl border border-border bg-bg p-5 shadow-2xl"
      data-testid="confirm-dialog"
    >
      {#if confirmState.request}
        <AlertDialog.Title class="font-semibold">{confirmState.request.title}</AlertDialog.Title>
        {#if confirmState.request.body}
          <AlertDialog.Description class="mt-1.5 text-sm text-fg-muted"
            >{confirmState.request.body}</AlertDialog.Description
          >
        {/if}
        <div class="mt-5 flex justify-end gap-2">
          <AlertDialog.Cancel
            class="rounded-md px-3 py-1.5 text-sm hover:bg-bg-hover"
            onclick={() => settleConfirm(false)}>Cancel</AlertDialog.Cancel
          >
          <AlertDialog.Action
            class="rounded-md px-3 py-1.5 text-sm font-medium text-white {confirmState.request
              .danger
              ? 'bg-danger'
              : 'bg-accent'}"
            onclick={() => settleConfirm(true)}
            data-testid="confirm-ok"
            >{confirmState.request.confirmLabel ?? 'Confirm'}</AlertDialog.Action
          >
        </div>
      {/if}
    </AlertDialog.Content>
  </AlertDialog.Portal>
</AlertDialog.Root>
