/** Normalizes a boolean column value (Postgres boolean or SQLite 0/1). */
export function toBool(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/** Nullable variant of {@link toBool}. */
export function toBoolOrNull(value: boolean | number | null | undefined): boolean | null {
  return value === null || value === undefined ? null : toBool(value);
}

/** Serializes a JSON column value for writing (both dialects store/return JSON as text). */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Parses a JSON column value read from either dialect. */
export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(value) as T;
}

/**
 * Escapes `%`, `_` and `\` for use in `LIKE ... ESCAPE '\'`, and wraps in `%` for substring search.
 * Pair with `lower(col) like lower(?)` for portable case-insensitive matching.
 */
export function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
