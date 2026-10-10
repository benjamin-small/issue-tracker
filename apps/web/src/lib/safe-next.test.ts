import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next.ts';

describe('safeNext', () => {
  it('keeps an app path with its query and hash', () => {
    expect(safeNext('/p/ENG?x=1')).toBe('/p/ENG?x=1');
    expect(safeNext('/i/ENG-42#c1')).toBe('/i/ENG-42#c1');
    expect(safeNext('/')).toBe('/');
  });

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash', '/\\evil.com'],
    ['tab', '/\t/evil.com'],
    ['newline', '/\n/evil.com'],
    ['absolute URL', 'https://evil.com'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'p/ENG'],
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
  ])('falls back to / for %s', (_, next) => {
    expect(safeNext(next)).toBe('/');
  });
});
