/** An in-app confirmation dialog (the browser's confirm() is blocked in some embeds and looks out of place). */
export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  danger?: boolean;
}

export const confirmState = $state({
  request: null as (ConfirmRequest & { resolve: (ok: boolean) => void }) | null,
});

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  confirmState.request?.resolve(false);
  return new Promise((resolve) => {
    confirmState.request = { ...request, resolve };
  });
}

export function settleConfirm(ok: boolean) {
  const request = confirmState.request;
  confirmState.request = null;
  request?.resolve(ok);
}
