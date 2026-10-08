import { defaultViewConfig, migrateViewConfig, type ViewConfig } from '@poietic-tech/issues-schema';

export type { ViewConfig };

/** Encodes a view config for the `?v=` URL parameter (shareable, and constructible by agents). */
export function encodeConfig(config: ViewConfig): string {
  const json = JSON.stringify(config);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeConfig(value: string | null): ViewConfig | undefined {
  if (!value) return undefined;
  try {
    const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    return migrateViewConfig(JSON.parse(json));
  } catch {
    return undefined;
  }
}

export function sameConfig(a: ViewConfig, b: ViewConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export { defaultViewConfig, migrateViewConfig };
