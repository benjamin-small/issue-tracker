import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './url.ts';

describe('parseDatabaseUrl', () => {
  it.each([
    ['sqlite:./data/dev.db', './data/dev.db'],
    ['sqlite:///var/lib/tracker.db', '/var/lib/tracker.db'],
    ['sqlite::memory:', ':memory:'],
  ])('parses %s as sqlite', (url, filename) => {
    expect(parseDatabaseUrl(url)).toEqual({ dialect: 'sqlite', filename });
  });

  it.each(['postgres://u:p@localhost:5432/tracker', 'postgresql://localhost/tracker'])(
    'parses %s as postgres',
    (url) => {
      expect(parseDatabaseUrl(url)).toEqual({ dialect: 'postgres', connectionString: url });
    },
  );

  it('rejects unknown schemes and empty sqlite paths', () => {
    expect(() => parseDatabaseUrl('mysql://localhost/x')).toThrow(/Unsupported/);
    expect(() => parseDatabaseUrl('sqlite:')).toThrow(/missing/);
  });
});
