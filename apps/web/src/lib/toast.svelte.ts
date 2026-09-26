export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  message: string;
  action?: { label: string; run: () => void };
}

let nextId = 1;
export const toasts = $state<Toast[]>([]);

export function toast(
  message: string,
  kind: Toast['kind'] = 'info',
  action?: Toast['action'],
  ms = 5000,
) {
  const id = nextId++;
  toasts.push({ id, kind, message, ...(action && { action }) });
  setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) toasts.splice(idx, 1);
}
