// Child process used by db.test.ts: increments a counter N times, each in its own write transaction.
// Run with Node's built-in type stripping: node concurrent-writer.ts <url> <iterations>
import { createDb } from '../dialect.ts';
import { withWriteTx } from '../tx.ts';

const [url, iterations] = process.argv.slice(2);
const db = createDb(url!);
try {
  for (let i = 0; i < Number(iterations); i++) {
    await withWriteTx(db, async (tx) => {
      const row = await tx
        .selectFrom('projects')
        .select('next_issue_number')
        .where('key', '=', 'CONC')
        .executeTakeFirstOrThrow();
      // Read-modify-write on purpose: only correct if the transaction is serialized.
      await tx
        .updateTable('projects')
        .set({ next_issue_number: row.next_issue_number + 1 })
        .where('key', '=', 'CONC')
        .execute();
    });
  }
} finally {
  await db.destroy();
}
