import { type Db, withWriteTx } from '@tracker/db';
import { type Clock, SYSTEM_ACTOR, systemClock } from '../context.ts';
import { newId } from '@tracker/schema';

/** Built-in link types. Keys are part of the API contract (`tracker link add ENG-1 blocks ENG-2`). */
export const BUILTIN_LINK_TYPES = [
  { key: 'blocks', name: 'Blocks', outward: 'blocks', inward: 'is blocked by', symmetric: false },
  { key: 'relates', name: 'Relates', outward: 'relates to', inward: 'relates to', symmetric: true },
  {
    key: 'duplicates',
    name: 'Duplicates',
    outward: 'duplicates',
    inward: 'is duplicated by',
    symmetric: false,
  },
] as const;

/**
 * Idempotently creates rows every installation needs: the internal `system` user and built-in link types.
 * Safe to call on every startup and after migrations.
 */
export async function ensureBuiltins(db: Db, clock: Clock = systemClock): Promise<void> {
  const now = clock.now().toISOString();
  await withWriteTx(db, async (tx) => {
    const system = await tx
      .selectFrom('users')
      .select('id')
      .where('id', '=', SYSTEM_ACTOR.id)
      .executeTakeFirst();
    if (!system) {
      await tx
        .insertInto('users')
        .values({
          id: SYSTEM_ACTOR.id,
          handle: SYSTEM_ACTOR.handle,
          name: SYSTEM_ACTOR.name,
          email: null,
          kind: 'system',
          role: 'admin',
          avatar_url: null,
          created_at: now,
          updated_at: now,
          deactivated_at: null,
        })
        .execute();
    }
    const existing = new Set(
      (await tx.selectFrom('link_types').select('key').execute()).map((r) => r.key),
    );
    for (const lt of BUILTIN_LINK_TYPES) {
      if (existing.has(lt.key)) continue;
      await tx
        .insertInto('link_types')
        .values({
          id: newId('linkType'),
          key: lt.key,
          name: lt.name,
          outward_label: lt.outward,
          inward_label: lt.inward,
          symmetric: lt.symmetric,
          built_in: true,
          created_at: now,
        })
        .execute();
    }
  });
}
