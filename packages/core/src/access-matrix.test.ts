import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, type ServiceContext, withActor } from './context.ts';
import { createComment, deleteComment } from './services/comments.ts';
import { createCustomField, deleteCustomField } from './services/custom-fields.ts';
import { createIssue, getIssue, listIssues, updateIssue } from './services/issues.ts';
import { createLabel } from './services/labels.ts';
import { createLink, deleteLink } from './services/links.ts';
import { addMember, removeMember } from './services/members.ts';
import { createProject, getProject, updateProject } from './services/projects.ts';
import { addRepo } from './services/repos.ts';
import { createUser } from './services/users.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';

/**
 * The access matrix of ADR 0021 as data. Rows are operations, columns are actor x visibility, and each
 * cell is `OK` or the exact error code the operation must fail with.
 *
 * Every cell runs against its own fresh project, so mutations in one cell can never change another, and
 * the cells can run in any order.
 *
 * "Deactivated user": a deactivated user's request resolves to the anonymous actor at the HTTP layer, so
 * the anonymous column covers that. In core the other way to lose access is losing the membership, so
 * `removed` is a member whose membership was taken away again.
 */

const OK = 'ok';
const NF = 'NOT_FOUND';
const FB = 'FORBIDDEN';
const UN = 'UNAUTHENTICATED';
type Expected = typeof OK | typeof NF | typeof FB | typeof UN;

const ACTORS = [
  'admin',
  'manager',
  'editor',
  'viewer',
  'nonMember',
  'anonymous',
  'removed',
] as const;
type ActorName = (typeof ACTORS)[number];
type Visibility = 'public' | 'private';

/** One entry per actor, in `ACTORS` order. */
type Column = readonly [Expected, Expected, Expected, Expected, Expected, Expected, Expected];

interface Operation {
  name: string;
  public: Column;
  private: Column;
  run(ctx: ServiceContext, w: World): Promise<unknown>;
}

/** The fixed data a cell's project starts with. */
interface World {
  key: string;
  issue: string;
  /** Written by `author`, who is neither of the acting users. */
  commentId: string;
  linkId: string;
  fieldId: string;
  visibility: Visibility;
}

// Columns:                                  admin manager editor viewer nonMember anonymous removed
const READ: Column = [OK, OK, OK, OK, OK, OK, OK];
const PRIVATE_READ: Column = [OK, OK, OK, OK, NF, NF, NF];
const PUBLIC_WRITE: Column = [OK, OK, OK, FB, FB, UN, FB];
const PRIVATE_WRITE: Column = [OK, OK, OK, FB, NF, NF, NF];
const PUBLIC_MANAGE: Column = [OK, OK, FB, FB, FB, UN, FB];
const PRIVATE_MANAGE: Column = [OK, OK, FB, FB, NF, NF, NF];

const OPERATIONS: Operation[] = [
  {
    name: 'read project',
    public: READ,
    private: PRIVATE_READ,
    run: (ctx, w) => getProject(ctx, w.key),
  },
  {
    name: 'list issues',
    public: READ,
    private: PRIVATE_READ,
    run: (ctx, w) => listIssues(ctx, { project: w.key }),
  },
  {
    name: 'read issue',
    public: READ,
    private: PRIVATE_READ,
    run: (ctx, w) => getIssue(ctx, w.issue),
  },
  {
    name: 'create issue',
    public: PUBLIC_WRITE,
    private: PRIVATE_WRITE,
    run: (ctx, w) => createIssue(ctx, w.key, { title: 'new' }),
  },
  {
    name: 'update issue',
    public: PUBLIC_WRITE,
    private: PRIVATE_WRITE,
    run: (ctx, w) => updateIssue(ctx, w.issue, { title: 'renamed' }),
  },
  {
    name: 'create comment',
    public: PUBLIC_WRITE,
    private: PRIVATE_WRITE,
    run: (ctx, w) => createComment(ctx, w.issue, { body: 'hello' }),
  },
  {
    // Editors may only change their own comments; moderating someone else's needs manage.
    name: "delete someone else's comment",
    public: PUBLIC_MANAGE,
    private: PRIVATE_MANAGE,
    run: (ctx, w) => deleteComment(ctx, w.commentId),
  },
  {
    name: 'create label',
    public: PUBLIC_WRITE,
    private: PRIVATE_WRITE,
    run: (ctx, w) => createLabel(ctx, w.key, { name: 'bug' }),
  },
  {
    name: 'delete custom field',
    public: PUBLIC_MANAGE,
    private: PRIVATE_MANAGE,
    run: (ctx, w) => deleteCustomField(ctx, w.fieldId),
  },
  {
    name: 'change visibility',
    public: PUBLIC_MANAGE,
    private: PRIVATE_MANAGE,
    run: (ctx, w) =>
      updateProject(ctx, w.key, { visibility: w.visibility === 'public' ? 'private' : 'public' }),
  },
  {
    name: 'add member',
    public: PUBLIC_MANAGE,
    private: PRIVATE_MANAGE,
    run: (ctx, w) => addMember(ctx, w.key, { user: '@newcomer', role: 'viewer' }),
  },
  {
    name: 'add repo',
    public: PUBLIC_MANAGE,
    private: PRIVATE_MANAGE,
    run: (ctx, w) => addRepo(ctx, w.key, { repo: 'acme/app' }),
  },
  {
    // Needs write on one end of the link; the link is stored within the one project here.
    name: 'delete link',
    public: PUBLIC_WRITE,
    private: PRIVATE_WRITE,
    run: (ctx, w) => deleteLink(ctx, w.linkId),
  },
];

describe(`access matrix (${testDialect()})`, () => {
  let t: TestContext;
  let cells = 0;

  beforeAll(async () => {
    t = await createTestContext();
    // Not a member of any matrix project: the target of "add member".
    await createUser(t.ctx, { handle: 'newcomer', name: 'Newcomer' });
  });
  afterAll(() => t.destroy());

  /** Builds a fresh project with its fixed data, and returns the acting context for `actor` on it. */
  async function cell(visibility: Visibility, actor: ActorName) {
    const key = `M${cells++}`;
    await createProject(t.ctx, { key, name: key, visibility });
    // `agent` authors the comment, so it is always someone else's from the acting user's point of view.
    await grant(t, key, t.agent, 'editor');
    const issue = await createIssue(t.ctx, key, { title: 'one' });
    const otherIssue = await createIssue(t.ctx, key, { title: 'two' });
    const comment = await createComment(t.agent, issue.key, { body: 'by the agent' });
    const link = await createLink(t.ctx, issue.key, { type: 'relates', target: otherIssue.key });
    const field = await createCustomField(t.ctx, key, { key: 'tier', name: 'Tier', type: 'text' });
    const world: World = {
      key,
      issue: issue.key,
      commentId: comment.id,
      linkId: link.id,
      fieldId: field.id,
      visibility,
    };

    let ctx: ServiceContext;
    switch (actor) {
      case 'admin':
        ctx = t.ctx;
        break;
      case 'anonymous':
        ctx = withActor(t.ctx, ANONYMOUS_ACTOR);
        break;
      case 'manager':
      case 'editor':
      case 'viewer':
        await grant(t, key, t.member, actor);
        ctx = t.member;
        break;
      case 'removed':
        await grant(t, key, t.member, 'manager');
        await removeMember(t.ctx, key, '@member');
        ctx = t.member;
        break;
      case 'nonMember':
        ctx = t.member;
        break;
    }
    return { ctx, world };
  }

  describe.each(OPERATIONS)('$name', (op) => {
    for (const visibility of ['public', 'private'] as const) {
      it.each(ACTORS.map((actor, i) => [actor, op[visibility][i]!] as const))(
        `${visibility}: %s -> %s`,
        async (actor, expected) => {
          const { ctx, world } = await cell(visibility, actor);
          const attempt = op.run(ctx, world);
          if (expected === OK)
            await attempt; // some operations resolve to nothing
          else await expect(attempt).rejects.toMatchObject({ code: expected });
        },
      );
    }
  });
});
