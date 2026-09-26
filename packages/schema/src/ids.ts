/**
 * Prefixes for TypeID-style identifiers (`<prefix>_<base32 UUIDv7>`).
 *
 * Every persisted entity gets a prefixed, time-ordered id so that an id is
 * self-describing: an agent (or a human reading logs) can tell an issue id
 * from a comment id at a glance, and APIs can reject ids of the wrong kind.
 *
 * Prefixes are part of the public API contract — never change an existing one.
 */
export const ID_PREFIXES = {
  user: 'usr',
  apiToken: 'tok',
  project: 'prj',
  status: 'sts',
  label: 'lbl',
  issue: 'iss',
  comment: 'cmt',
  linkType: 'lty',
  issueLink: 'lnk',
  customField: 'fld',
  customFieldOption: 'opt',
  fieldValue: 'fvl',
  attachment: 'att',
  view: 'viw',
  event: 'evt',
  webhook: 'whk',
  webhookDelivery: 'whd',
} as const;

export type EntityKind = keyof typeof ID_PREFIXES;
export type IdPrefix = (typeof ID_PREFIXES)[EntityKind];

/** Matches the TypeID suffix alphabet: 26 chars of Crockford base32, first char 0-7. */
const SUFFIX = '[0-7][0-9a-hjkmnp-tv-z]{25}';

/** Returns true if `value` is a well-formed id for the given entity kind. */
export function isIdOf(kind: EntityKind, value: string): boolean {
  return new RegExp(`^${ID_PREFIXES[kind]}_${SUFFIX}$`).test(value);
}
