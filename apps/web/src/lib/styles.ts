/**
 * Shared class strings for the app's basic controls, so buttons and inputs look and behave the same
 * everywhere (hover, focus and disabled states included).
 */
const base =
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const btn = {
  primary: `${base} bg-accent px-3 py-1.5 text-sm text-accent-fg hover:bg-accent/90`,
  primarySm: `${base} bg-accent px-2 py-1 text-xs text-accent-fg hover:bg-accent/90`,
  secondary: `${base} border border-border bg-bg px-3 py-1.5 text-sm text-fg hover:bg-bg-hover`,
  ghost: `${base} px-2 py-1 text-sm text-fg-muted hover:bg-bg-hover hover:text-fg`,
  danger: `${base} bg-danger px-3 py-1.5 text-sm text-white hover:bg-danger/90`,
};

/** Bordered text input used in forms and settings. */
export const input =
  'rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50';
