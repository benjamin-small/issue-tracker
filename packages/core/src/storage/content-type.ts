/**
 * Content-type detection from magic bytes. The client-declared type is never trusted: a file claiming to be
 * `image/png` that is really HTML must not be served as an image.
 */
const SIGNATURES: Array<{ type: string; bytes: (number | null)[]; offset?: number }> = [
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  {
    type: 'image/webp',
    bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  { type: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] },
  { type: 'application/gzip', bytes: [0x1f, 0x8b] },
];

/** Types that are safe to render inline in a browser (raster images only — never SVG, HTML or PDF). */
export const INLINE_SAFE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, 4096);
  for (const b of sample) if (b === 0 || (b < 9 && b !== 0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(
      sample.length < data.length ? sample.subarray(0, sample.length - 4) : sample,
    );
    return true;
  } catch {
    return false;
  }
}

export function sniffContentType(data: Uint8Array, filename: string): string {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (
      data.length >= offset + sig.bytes.length &&
      sig.bytes.every((b, i) => b === null || data[offset + i] === b)
    )
      return sig.type;
  }
  if (looksLikeText(data)) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.json')) return 'application/json';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
    if (lower.endsWith('.csv')) return 'text/csv';
    // HTML, SVG and everything else textual is served as plain text (never as markup).
    return 'text/plain';
  }
  return 'application/octet-stream';
}

/** Strips paths, control characters and separators from an uploaded filename. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .trim()
    .slice(0, 200);
  return clean || 'file';
}

/** RFC 6266 / 5987 Content-Disposition value. */
export function contentDisposition(kind: 'inline' | 'attachment', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
