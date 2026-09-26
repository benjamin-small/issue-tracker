/**
 * Parsed form of `DATABASE_URL`. The URL scheme selects the dialect:
 *
 * - `sqlite:./data/dev.db`, `sqlite:///abs/path.db`, `sqlite::memory:` → SQLite (development, tests, CLI local mode)
 * - `postgres://…` / `postgresql://…` → Postgres (production)
 */
export type DatabaseConfig =
  { dialect: 'sqlite'; filename: string } | { dialect: 'postgres'; connectionString: string };

export function parseDatabaseUrl(url: string): DatabaseConfig {
  const trimmed = url.trim();
  if (/^postgres(ql)?:\/\//i.test(trimmed)) {
    return { dialect: 'postgres', connectionString: trimmed };
  }
  const sqlite = /^sqlite:(.*)$/i.exec(trimmed);
  if (sqlite) {
    let filename = sqlite[1] ?? '';
    // sqlite:///abs/path → /abs/path ; sqlite://rel/path → rel/path
    if (filename.startsWith('//')) filename = filename.slice(2);
    if (filename === '') throw new Error(`DATABASE_URL "${url}" is missing a SQLite filename`);
    return { dialect: 'sqlite', filename };
  }
  throw new Error(`Unsupported DATABASE_URL "${url}": expected "sqlite:<file>" or "postgres://…"`);
}
