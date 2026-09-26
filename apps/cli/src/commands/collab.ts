import { Command } from 'commander';
import { usage } from '../errors.ts';
import type { CliIO } from '../io.ts';
import { makeAction, readTextArg, type Runtime } from '../runtime.ts';

type Opts = Record<string, unknown>;

/** Natural-language link aliases → [type, direction]. */
const LINK_ALIASES: Record<string, [string, 'outward' | 'inward']> = {
  blocks: ['blocks', 'outward'],
  'blocked-by': ['blocks', 'inward'],
  'is-blocked-by': ['blocks', 'inward'],
  relates: ['relates', 'outward'],
  'relates-to': ['relates', 'outward'],
  duplicates: ['duplicates', 'outward'],
  'duplicated-by': ['duplicates', 'inward'],
  'is-duplicated-by': ['duplicates', 'inward'],
};

async function bodyFrom(rt: Runtime, words: string[] | undefined, o: Opts): Promise<string> {
  if (o.bodyFile) return readTextArg(rt.io, String(o.bodyFile));
  if (o.body) return String(o.body);
  if (words?.length) return words.join(' ');
  throw usage('Provide the text as arguments, --body, or --body-file <path|->');
}

export function commentCommand(io: CliIO): Command {
  const act = (fn: (rt: Runtime, args: unknown[], o: Opts) => Promise<void>) => makeAction(io, fn);
  const cmd = new Command('comment').description('Discuss issues');
  cmd
    .command('list')
    .alias('ls')
    .description('List comments on an issue (oldest first)')
    .argument('<issue>', 'issue key or id')
    .action(
      act(async (rt, [issue]) => {
        const api = await rt.api();
        rt.out.list(
          'comment',
          (
            await rt.call(
              api.GET('/issues/{issue}/comments', {
                params: { path: { issue: String(issue) }, query: {} },
              }),
            )
          ).data,
        );
      }),
    );
  cmd
    .command('add')
    .description('Comment on an issue (markdown)')
    .argument('<issue>', 'issue key or id')
    .argument('[text...]', 'comment text')
    .option('-b, --body <markdown>', 'comment text')
    .option('--body-file <path>', 'read the text from a file, or - for stdin')
    .action(
      act(async (rt, [issue, words], o) => {
        const api = await rt.api();
        const body = await bodyFrom(rt, words as string[], o);
        rt.out.item(
          'comment',
          await rt.call(
            api.POST('/issues/{issue}/comments', {
              params: { path: { issue: String(issue) } },
              body: { body },
            }),
          ),
        );
      }),
    );
  cmd
    .command('edit')
    .description('Edit your comment')
    .argument('<id>', 'comment id')
    .argument('[text...]', 'new text')
    .option('-b, --body <markdown>', 'new text')
    .option('--body-file <path>', 'read the text from a file, or - for stdin')
    .action(
      act(async (rt, [id, words], o) => {
        const api = await rt.api();
        const body = await bodyFrom(rt, words as string[], o);
        rt.out.item(
          'comment',
          await rt.call(
            api.PATCH('/comments/{id}', { params: { path: { id: String(id) } }, body: { body } }),
          ),
        );
      }),
    );
  cmd
    .command('delete')
    .alias('rm')
    .description('Delete your comment')
    .argument('<id>', 'comment id')
    .action(
      act(async (rt, [id]) => {
        const api = await rt.api();
        rt.out.item(
          'comment',
          await rt.call(api.DELETE('/comments/{id}', { params: { path: { id: String(id) } } })),
          () => 'Comment deleted\n',
        );
      }),
    );
  return cmd;
}

export function linkCommand(io: CliIO): Command {
  const act = (fn: (rt: Runtime, args: unknown[], o: Opts) => Promise<void>) => makeAction(io, fn);
  const cmd = new Command('link').description('Relate issues (blocks, relates, duplicates)');
  cmd
    .command('list')
    .alias('ls')
    .description("List an issue's links from its perspective")
    .argument('<issue>', 'issue key or id')
    .action(
      act(async (rt, [issue]) => {
        const api = await rt.api();
        rt.out.list(
          'link',
          (
            await rt.call(
              api.GET('/issues/{issue}/links', { params: { path: { issue: String(issue) } } }),
            )
          ).data,
        );
      }),
    );
  cmd
    .command('add')
    .description(
      'Link two issues, e.g. `link add ENG-1 blocks ENG-2` or `link add ENG-2 blocked-by ENG-1`',
    )
    .argument('<issue>', 'issue key or id')
    .argument('<relation>', `link type key or alias (${Object.keys(LINK_ALIASES).join(', ')})`)
    .argument('<target>', 'the other issue')
    .action(
      act(async (rt, [issue, relation, target]) => {
        const api = await rt.api();
        const [type, direction] = LINK_ALIASES[String(relation).toLowerCase()] ?? [
          String(relation),
          'outward',
        ];
        rt.out.item(
          'link',
          await rt.call(
            api.POST('/issues/{issue}/links', {
              params: { path: { issue: String(issue) } },
              body: { type, target: String(target), direction },
            }),
          ),
        );
      }),
    );
  cmd
    .command('remove')
    .alias('rm')
    .description('Remove a link by id (see `link list`)')
    .argument('<id>', 'link id')
    .action(
      act(async (rt, [id]) => {
        const api = await rt.api();
        const res = await api.DELETE('/links/{id}', { params: { path: { id: String(id) } } });
        await rt.call(res as never);
        rt.out.item('raw', { id: String(id), removed: true }, () => 'Link removed\n');
      }),
    );
  cmd
    .command('types')
    .description('List link types')
    .action(
      act(async (rt) => {
        const api = await rt.api();
        rt.out.list('linkType', (await rt.call(api.GET('/link-types'))).data);
      }),
    );
  return cmd;
}

/** The event log is global; filter by project only when --project/TRACKER_PROJECT is given explicitly. */
function explicitProject(rt: Runtime): string | undefined {
  return rt.config.sources.project === 'flag' || rt.config.sources.project === 'env'
    ? rt.config.project
    : undefined;
}

export function eventCommand(io: CliIO): Command {
  const act = (fn: (rt: Runtime, args: unknown[], o: Opts) => Promise<void>) => makeAction(io, fn);
  const cmd = new Command('event').description(
    'Read the event log (what changed, in commit order)',
  );
  const filters = (c: Command) =>
    c
      .option('--issue <issue>', 'only this issue (use the global --project to filter by project)')
      .option('--types <types>', 'comma-separated event types, e.g. issue.created,issue.updated');
  filters(
    cmd
      .command('list')
      .alias('ls')
      .description('List events after a sequence number (use the last seq you saw as --after)')
      .option('--after <seq>', 'exclusive cursor', (v) => Number(v))
      .option('--limit <n>', 'max events (1-1000)', (v) => Number(v)),
  ).action(
    act(async (rt, _a, o) => {
      const api = await rt.api();
      const data = await rt.call(
        api.GET('/events', {
          params: {
            query: {
              ...(o.after !== undefined && { after: Number(o.after) }),
              ...(o.limit !== undefined && { limit: Number(o.limit) }),
              ...(explicitProject(rt) && { project: explicitProject(rt)! }),
              ...(o.issue !== undefined && { issue: String(o.issue) }),
              ...(o.types !== undefined && { types: String(o.types) }),
            },
          },
        }),
      );
      rt.out.list('event', data);
    }),
  );
  filters(
    cmd
      .command('tail')
      .description('Follow new events as NDJSON (one event per line) until interrupted')
      .option('--after <seq>', 'start after this seq (default: now)', (v) => Number(v))
      .option('--interval <ms>', 'poll interval', (v) => Number(v), 1000)
      .option('--max <n>', 'exit after this many events', (v) => Number(v)),
  ).action(
    act(async (rt, _a, o) => {
      const api = await rt.api();
      const query = {
        ...(explicitProject(rt) && { project: explicitProject(rt)! }),
        ...(o.issue !== undefined && { issue: String(o.issue) }),
        ...(o.types !== undefined && { types: String(o.types) }),
      };
      let after = o.after as number | undefined;
      if (after === undefined) {
        // Start from the current end of the log.
        after = 0;
        for (;;) {
          const page: { data: Array<{ seq: number }>; nextCursor: string | null } = await rt.call(
            api.GET('/events', { params: { query: { after, limit: 1000 } } }),
          );
          after = page.data.at(-1)?.seq ?? after;
          if (!page.nextCursor) break;
        }
      }
      let emitted = 0;
      const max = o.max as number | undefined;
      for (;;) {
        const page: { data: Array<{ seq: number }>; nextCursor: string | null } = await rt.call(
          api.GET('/events', { params: { query: { ...query, after, limit: 1000 } } }),
        );
        for (const event of page.data) {
          rt.io.stdout(`${JSON.stringify(event)}\n`);
          after = event.seq;
          if (max !== undefined && ++emitted >= max) return;
        }
        if (!page.nextCursor) await new Promise((r) => setTimeout(r, Number(o.interval)));
      }
    }),
  );
  return cmd;
}
