import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createProject } from '@tracker/core';
import { createTestContext, type TestContext } from '@tracker/core/testing';
import { testDialect } from '@tracker/db/testing';
import { createApp } from '@tracker/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CliIO } from './io.ts';
import { renderCliReference } from './reference.ts';
import { run } from './main.ts';

let t: TestContext;
let appFetch: (r: Request) => Promise<Response>;
const dir = mkdtempSync(join(tmpdir(), 'tracker-cli-'));

/** Runs the CLI in-process against the test database (as `admin`), capturing output. */
async function cli(
  args: string[],
  opts: { stdin?: string; env?: Record<string, string>; fetch?: CliIO['fetch'] | null } = {},
) {
  let stdout = '';
  let stderr = '';
  const io: CliIO = {
    stdout: (s) => (stdout += s),
    stderr: (s) => (stderr += s),
    env: { HOME: dir, XDG_CONFIG_HOME: join(dir, 'config'), TRACKER_PROJECT: 'CLI', ...opts.env },
    cwd: dir,
    readStdin: async () => opts.stdin ?? '',
    isTTY: false,
    ...(opts.fetch !== null && { fetch: opts.fetch ?? appFetch }),
  };
  const code = await run(args, io);
  return { code, stdout, stderr, json: () => JSON.parse(stdout) };
}

beforeAll(async () => {
  t = await createTestContext();
  await createProject(t.ctx, { key: 'CLI', name: 'CLI' });
  const app = createApp({ db: t.db, auth: { mode: 'trusted', actor: 'admin' } });
  appFetch = (r) => Promise.resolve(app.fetch(r));
});
afterAll(async () => {
  await t.destroy();
  rmSync(dir, { recursive: true, force: true });
});

describe(`tracker CLI (${testDialect()})`, () => {
  it('creates issues and prints JSON, ids or tables', async () => {
    const created = await cli(['issue', 'create', '-t', 'First from CLI', '-p', 'high', '--json']);
    expect(created.code).toBe(0);
    expect(created.json()).toMatchObject({ key: 'CLI-1', priority: 2, title: 'First from CLI' });

    const quiet = await cli(['issue', 'create', '--title', 'Second', '-q']);
    expect(quiet.stdout).toBe('CLI-2\n');

    const table = await cli(['issue', 'list', '--sort', 'key']);
    expect(table.stdout.split('\n')[0]).toMatch(/^KEY\s+STATUS\s+PRI\s+ASSIGNEE\s+LABELS\s+TITLE$/);
    expect(table.stdout).toContain('CLI-1');
  });

  it('reads descriptions and full payloads from stdin', async () => {
    const res = await cli(['issue', 'create', '-t', 'From stdin', '--body-file', '-', '--json'], {
      stdin: '# Heading\n\nBody',
    });
    expect(res.json().description).toBe('# Heading\n\nBody');
    const input = await cli(['issue', 'create', '--input', '-', '--json'], {
      stdin: JSON.stringify({ title: 'Payload', priority: 4, metadata: { 'agent.run': 7 } }),
    });
    expect(input.json()).toMatchObject({
      title: 'Payload',
      priority: 4,
      metadata: { 'agent.run': 7 },
    });
  });

  it('filters, projects fields and paginates', async () => {
    const label = await cli(['label', 'create', 'bug', '--color', '#ff0000']);
    expect(label.stderr).toBe('');
    const edited = await cli([
      'issue',
      'edit',
      'CLI-1',
      '--add-label',
      'bug',
      '--assignee',
      'me',
      '-s',
      'In Progress',
    ]);
    expect(edited.stderr).toBe('');
    expect(edited.code).toBe(0);
    const filtered = await cli([
      'issue',
      'list',
      '--label',
      'bug',
      '--assignee',
      'me',
      '--json',
      '--fields',
      'key,status,labels,assignee.handle',
    ]);
    expect(filtered.json()).toEqual({
      data: [
        {
          key: 'CLI-1',
          status: expect.objectContaining({ name: 'In Progress' }),
          labels: [expect.objectContaining({ name: 'bug' })],
          'assignee.handle': 'admin',
        },
      ],
      nextCursor: null,
    });
    const where = await cli([
      'issue',
      'list',
      '-w',
      'priority.gte=2',
      '-w',
      'title.contains=from',
      '-q',
    ]);
    expect(where.stdout.trim().split('\n')).toEqual(['CLI-1']);
    const page = await cli(['issue', 'list', '--limit', '2', '--sort', 'key', '--json']);
    expect(page.json().data).toHaveLength(2);
    expect(page.json().nextCursor).toBeTruthy();
    const all = await cli([
      'issue',
      'list',
      '--limit',
      '2',
      '--sort',
      'key',
      '--all',
      '--format',
      'ndjson',
    ]);
    expect(
      all.stdout
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l).key),
    ).toEqual(['CLI-1', 'CLI-2', 'CLI-3', 'CLI-4']);
  });

  it('maps API errors to documented exit codes and problem JSON on stderr', async () => {
    const missing = await cli(['issue', 'view', 'CLI-999', '--json']);
    expect(missing.code).toBe(3);
    expect(missing.stdout).toBe('');
    expect(JSON.parse(missing.stderr)).toMatchObject({ code: 'NOT_FOUND' });

    const stale = await cli(['issue', 'edit', 'CLI-1', '-t', 'x', '--if-version', '1']);
    expect(stale.code).toBe(4);
    expect(stale.stderr).toMatch(/VERSION_MISMATCH/);

    const invalid = await cli(['issue', 'create', '-t', 'x', '--label', 'nope']);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toMatch(/Unknown label/);

    const usage = await cli(['issue', 'create', '--priority', 'extreme']);
    expect(usage.code).toBe(2);
    const unknown = await cli(['issue', 'frobnicate']);
    expect(unknown.code).toBe(2);
    expect((await cli(['--version'])).code).toBe(0);
    expect((await cli(['issue', 'list'], { env: { TRACKER_PROJECT: '' } })).stderr).toMatch(
      /No project given/,
    );
  });

  it('edits several issues atomically, moves, deletes and restores', async () => {
    const bulk = await cli(['issue', 'edit', 'CLI-2', 'CLI-3', '--priority', 'low', '--json']);
    expect(bulk.json().data.map((i: { priority: number }) => i.priority)).toEqual([4, 4]);
    const moved = await cli(['issue', 'move', 'CLI-2', '--status', 'Done', '--json']);
    expect(moved.json().status.name).toBe('Done');
    expect((await cli(['issue', 'delete', 'CLI-4', '--json'])).json().deletedAt).not.toBeNull();
    expect((await cli(['issue', 'restore', 'CLI-4', '--json'])).json().deletedAt).toBeNull();
  });

  it('comments and links with natural aliases', async () => {
    const comment = await cli(['comment', 'add', 'CLI-1', 'Looks', 'good', '--json']);
    expect(comment.json().body).toBe('Looks good');
    const fromStdin = await cli(['comment', 'add', 'CLI-1', '--body-file', '-', '-q'], {
      stdin: 'piped',
    });
    expect(fromStdin.stdout).toMatch(/^cmt_/);
    expect((await cli(['comment', 'list', 'CLI-1', '--json'])).json().data).toHaveLength(2);

    const link = await cli(['link', 'add', 'CLI-2', 'blocked-by', 'CLI-1', '--json']);
    expect(link.json()).toMatchObject({ label: 'is blocked by', issue: { key: 'CLI-1' } });
    const fromOther = await cli(['link', 'list', 'CLI-1', '--json']);
    expect(fromOther.json().data[0]).toMatchObject({ label: 'blocks', issue: { key: 'CLI-2' } });
  });

  it('reads the event log and tails it', async () => {
    const events = await cli(['event', 'list', '--json', '--limit', '1000']);
    const seqs = events.json().data.map((e: { seq: number }) => e.seq);
    const tail = await cli(['event', 'tail', '--after', String(seqs.at(-3)), '--max', '2']);
    expect(
      tail.stdout
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l).seq),
    ).toEqual(seqs.slice(-2));
    const history = await cli(['issue', 'activity', 'CLI-1', '--json']);
    expect(history.json().data.map((e: { type: string }) => e.type)).toContain('comment.created');
  });

  it('describes itself for agents', async () => {
    const res = await cli(['commands', '--json']);
    const info = res.json();
    const names = info.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'issue create',
        'issue list',
        'link add',
        'event tail',
        'schema',
        'api',
      ]),
    );
    expect(info.exitCodes['3']).toBe('Not found');
    expect(info.errorCodes.VERSION_MISMATCH).toEqual({ status: 412, exit: 4 });
    // Golden file: changes to the command surface must be deliberate (update with `vitest -u`).
    await expect(`${JSON.stringify(info, null, 2)}\n`).toMatchFileSnapshot(
      '../test/commands.golden.json',
    );
    // The CLI reference in docs/ is generated from the same description (update with `vitest -u`).
    await expect(renderCliReference(info)).toMatchFileSnapshot('../../../docs/cli-reference.md');

    const schema = await cli(['schema', 'issue-create']);
    expect(JSON.parse(schema.stdout).required).toEqual(['title']);
    const live = await cli(['project', 'schema']);
    expect(JSON.parse(live.stdout).create.properties.labels.items.enum).toEqual(['bug']);
    const help = await cli(['issue', 'create', '--help']);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('--body-file <path>');
  });

  it('never shadows a global option in a subcommand (commander would swallow it)', async () => {
    const info = (await cli(['commands', '--json'])).json();
    const globals = new Set(
      info.globalOptions.flatMap((o: { flags: string }) =>
        o.flags.split(/[ ,|]+/).filter((f: string) => f.startsWith('-')),
      ),
    );
    for (const command of info.commands)
      for (const option of command.options)
        for (const flag of option.flags.split(/[ ,|]+/).filter((f: string) => f.startsWith('-')))
          expect({ command: command.name, flag, clash: globals.has(flag) }).toEqual({
            command: command.name,
            flag,
            clash: false,
          });
  });

  it('defines custom fields and sets/filters them', async () => {
    const created = await cli([
      'field',
      'create',
      'severity',
      '--type',
      'select',
      '--option',
      'low,high',
      '--json',
    ]);
    expect(created.json()).toMatchObject({
      key: 'severity',
      type: 'select',
      options: [{ value: 'low' }, { value: 'high' }],
    });
    await cli(['field', 'create', 'points', '--type', 'number', '-n', 'Points']);
    const issue = await cli([
      'issue',
      'create',
      '-t',
      'With fields',
      '--set',
      'severity=high',
      '--set',
      'points=3',
      '--json',
    ]);
    expect(issue.json().customFields).toEqual({ severity: 'high', points: 3 });
    const found = await cli([
      'issue',
      'list',
      '-w',
      'cf.severity=high',
      '-w',
      'cf.points.gte=2',
      '-q',
    ]);
    expect(found.stdout.trim()).toBe(issue.json().key);
    const bad = await cli(['issue', 'edit', issue.json().key, '--set', 'severity=medium']);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/unknown option "medium"/);
    await cli(['field', 'option-add', 'severity', 'medium']);
    expect((await cli(['issue', 'edit', issue.json().key, '--set', 'severity=medium'])).code).toBe(
      0,
    );
    const list = await cli(['field', 'list']);
    expect(list.stdout).toContain('severity  severity  [select]');
    expect(list.stdout).toContain('options: low, high, medium');
  });

  it('calls arbitrary endpoints with `api`', async () => {
    const res = await cli(['api', 'GET', '/issues/CLI-1']);
    expect(JSON.parse(res.stdout).key).toBe('CLI-1');
    const created = await cli(['api', 'POST', '/projects/CLI/labels', '-f', 'name=api-made']);
    expect(JSON.parse(created.stdout).name).toBe('api-made');
    expect((await cli(['api', 'GET', '/issues/NOPE-1'])).code).toBe(3);
  });
});

describe.runIf(testDialect() === 'sqlite')('local and remote modes (real transports)', () => {
  it('runs in-process against a local SQLite file', async () => {
    const db = join(dir, 'local.db');
    const env = { TRACKER_DATABASE_URL: `sqlite:${db}` };
    const unmigrated = await cli(['issue', 'list'], { env, fetch: null });
    expect(unmigrated.code).toBe(6);
    expect(unmigrated.stderr).toMatch(/tracker db migrate/);
    expect((await cli(['db', 'migrate'], { env, fetch: null })).stdout).toMatch(
      /Applied: 0001_init/,
    );
    const seeded = await cli(['db', 'seed', '--json'], { env, fetch: null });
    expect(seeded.json().agentToken).toMatch(/^trk_/);
    const list = await cli(['issue', 'list', '--project', 'ENG', '-q', '--sort', 'key'], {
      env,
      fetch: null,
    });
    expect(list.stdout.trim().split('\n')[0]).toBe('ENG-1');
    const me = await cli(['whoami', '--json'], {
      env: { ...env, TRACKER_ACTOR: 'claude' },
      fetch: null,
    });
    expect(me.json()).toMatchObject({ handle: 'claude', kind: 'agent' });
  });

  it('talks to a real server with a token, and logs in', async () => {
    const { loadConfig, startServer } = await import('@tracker/server');
    const server = await startServer(
      loadConfig({
        TRACKER_DATABASE_URL: `sqlite:${join(dir, 'remote.db')}`,
        TRACKER_PORT: '0',
        TRACKER_SEED: '1',
      }),
    );
    try {
      const token = (
        await (
          await import('@tracker/core')
        ).createToken(
          {
            ...t.ctx,
            db: server.db,
            actor: (await (
              await import('@tracker/core')
            ).actorForUser({ db: server.db, actor: t.admin }, 'ada'))!,
          },
          'ada',
          { name: 'cli-test' },
        )
      ).token;
      const env = { TRACKER_SERVER: server.url, TRACKER_TOKEN: token };
      const created = await cli(['issue', 'create', '-P', 'ENG', '-t', 'Over HTTP', '--json'], {
        env,
        fetch: null,
      });
      expect(created.stderr).toBe('');
      expect(created.code).toBe(0);
      expect(created.json().creator.handle).toBe('ada');
      expect(
        (
          await cli(['whoami', '-q'], {
            env: { TRACKER_SERVER: server.url, TRACKER_TOKEN: 'trk_bad' },
            fetch: null,
          })
        ).code,
      ).toBe(5);

      const login = await cli(['auth', 'login', '--server', server.url, '--with-token'], {
        stdin: token,
        fetch: null,
      });
      expect(login.code).toBe(0);
      const status = await cli(['auth', 'status', '--json'], { fetch: null });
      expect(status.json()).toMatchObject({ mode: 'remote', user: { handle: 'ada' } });
    } finally {
      await server.close();
    }
    const down = await cli(['whoami'], {
      env: { TRACKER_SERVER: 'http://127.0.0.1:9', TRACKER_TOKEN: 'x' },
      fetch: null,
    });
    expect(down.code).toBe(6);
  }, 30_000);

  it('works as a spawned binary', async () => {
    const bin = fileURLToPath(new URL('./bin.ts', import.meta.url));
    const exec = promisify(execFile);
    const version = await exec(process.execPath, [bin, '--version']);
    expect(version.stdout.trim()).toBe('0.1.0');
    const failure = await exec(process.execPath, [bin, 'issue', 'view', 'ENG-999', '--json'], {
      env: { ...process.env, TRACKER_DATABASE_URL: `sqlite:${join(dir, 'local.db')}`, HOME: dir },
    }).catch((e: { code: number; stderr: string }) => e);
    expect(failure).toMatchObject({ code: 3 });
    expect(JSON.parse((failure as { stderr: string }).stderr).code).toBe('NOT_FOUND');
  }, 30_000);
});
