import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, isIdOf } from './ids.ts';

describe('ID_PREFIXES', () => {
  it('are unique', () => {
    const values = Object.values(ID_PREFIXES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('are 3 lowercase letters', () => {
    for (const prefix of Object.values(ID_PREFIXES)) expect(prefix).toMatch(/^[a-z]{3}$/);
  });
});

describe('isIdOf', () => {
  const valid = 'iss_01h455vb4pex5vsknk084sn02q';

  it('accepts a well-formed id of the right kind', () => {
    expect(isIdOf('issue', valid)).toBe(true);
  });

  it('rejects ids of another kind or malformed suffixes', () => {
    expect(isIdOf('comment', valid)).toBe(false);
    expect(isIdOf('issue', 'iss_01h455vb4pex5vsknk084sn02')).toBe(false); // too short
    expect(isIdOf('issue', 'iss_81h455vb4pex5vsknk084sn02q')).toBe(false); // first char > 7
    expect(isIdOf('issue', 'iss_01h455vb4pex5vsknk084sn0uq')).toBe(false); // 'u' not in alphabet
  });
});
