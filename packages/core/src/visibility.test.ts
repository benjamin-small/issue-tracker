import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, type ServiceContext, withActor } from './context.ts';
import { createIssue, getIssue, listIssues, updateIssue } from './services/issues.ts';
import { createProject, getProject } from './services/projects.ts';
import { LocalDiskBlobStore } from './storage/blob-store.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';

describe(`project visibility (${testDialect()})`, () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await createTestContext();
    await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    await createProject(t.ctx, { key: 'PRV', name: 'Private' });
    await createIssue(t.ctx, 'PUB', { title: 'open' });
    await createIssue(t.ctx, 'PRV', { title: 'secret' });
  });
  afterAll(() => t.destroy());

  it('hides private projects and their issues as not found', async () => {
    await expect(getProject(t.member, 'PRV')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getIssue(t.member, 'PRV-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets anyone read public projects but only editors write', async () => {
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    expect((await getIssue(anon, 'PUB-1')).title).toBe('open');
    await expect(updateIssue(anon, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(updateIssue(t.member, 'PUB-1', { title: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PUB', t.member, 'editor');
    expect((await updateIssue(t.member, 'PUB-1', { title: 'x' })).title).toBe('x');
  });

  /** Removes any membership so a test starts from "no role" regardless of earlier grants. */
  async function revoke(projectKey: string, who: ServiceContext) {
    const project = await t.db.kysely
      .selectFrom('projects')
      .select('id')
      .where('key', '=', projectKey)
      .executeTakeFirstOrThrow();
    await t.db.kysely
      .deleteFrom('project_members')
      .where('project_id', '=', project.id)
      .where('user_id', '=', who.actor.id)
      .execute();
  }

  it('checks the parent project for lookups by id', async () => {
    const { listLabels, createLabel, updateLabel } = await import('./services/labels.ts');
    const label = await createLabel(t.ctx, 'PRV', { name: 'secret-label' });
    await revoke('PRV', t.member);
    await expect(updateLabel(t.member, label.id, { name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await grant(t, 'PRV', t.member, 'viewer');
    await expect(updateLabel(t.member, label.id, { name: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect((await listLabels(t.member, 'PRV')).map((l) => l.name)).toContain('secret-label');
  });

  it('applies the same check to statuses, custom fields and options', async () => {
    const { createCustomField, getCustomField, updateCustomField, addFieldOption } =
      await import('./services/custom-fields.ts');
    const { listStatuses, updateStatus, deleteStatus } = await import('./services/statuses.ts');
    const field = await createCustomField(t.ctx, 'PRV', {
      key: 'kind',
      name: 'Kind',
      type: 'select',
      options: [{ value: 'a' }],
    });
    const [status] = await listStatuses(t.ctx, 'PRV');
    await revoke('PRV', t.member);
    await expect(getCustomField(t.member, field.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(updateStatus(t.member, status!.id, { name: 'z' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(deleteStatus(t.member, status!.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await grant(t, 'PRV', t.member, 'viewer');
    expect((await getCustomField(t.member, field.id)).key).toBe('kind');
    await expect(updateCustomField(t.member, field.id, { name: 'z' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(addFieldOption(t.member, field.id, { value: 'b' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(updateStatus(t.member, status!.id, { name: 'z' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PRV', t.member, 'editor');
    expect((await updateCustomField(t.member, field.id, { name: 'Kind 2' })).name).toBe('Kind 2');
    const option = field.options[0]!;
    const { updateFieldOption } = await import('./services/custom-fields.ts');
    expect((await updateFieldOption(t.member, option.id, { label: 'A' })).options[0]!.label).toBe(
      'A',
    );
  });

  it('lets managers moderate comments and delete custom fields', async () => {
    const { createComment, updateComment } = await import('./services/comments.ts');
    const { createCustomField, deleteCustomField } = await import('./services/custom-fields.ts');
    await grant(t, 'PRV', t.agent, 'editor');
    const comment = await createComment(t.agent, 'PRV-1', { body: 'hi' });
    await grant(t, 'PRV', t.member, 'editor');
    await expect(updateComment(t.member, comment.id, { body: 'edited' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    const field = await createCustomField(t.member, 'PRV', {
      key: 'tier',
      name: 'Tier',
      type: 'text',
    });
    await expect(deleteCustomField(t.member, field.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PRV', t.member, 'manager');
    expect((await updateComment(t.member, comment.id, { body: 'edited' })).body).toBe('edited');
    expect((await deleteCustomField(t.member, field.id)).id).toBe(field.id);
  });

  it('keeps authors in control of their own comments, and hides them without access', async () => {
    const { createComment, updateComment, deleteComment } = await import('./services/comments.ts');
    await grant(t, 'PRV', t.member, 'editor');
    const mine = await createComment(t.member, 'PRV-1', { body: 'mine' });
    expect((await updateComment(t.member, mine.id, { body: 'mine 2' })).body).toBe('mine 2');
    await revoke('PRV', t.member);
    await expect(updateComment(t.member, mine.id, { body: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await grant(t, 'PRV', t.member, 'viewer');
    await expect(deleteComment(t.member, mine.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await grant(t, 'PRV', t.member, 'editor');
    expect((await deleteComment(t.member, mine.id)).id).toBe(mine.id);
  });

  it('rejects writes from viewers', async () => {
    const { createComment } = await import('./services/comments.ts');
    await grant(t, 'PRV', t.member, 'viewer');
    await expect(createComment(t.member, 'PRV-1', { body: 'nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('lets managers moderate attachments and checks access on read', async () => {
    const { uploadAttachment, getAttachment, deleteAttachment } =
      await import('./services/attachments.ts');
    const blobs = new LocalDiskBlobStore(join(mkdtempSync(join(tmpdir(), 'vis-blobs-')), 'b'));
    await grant(t, 'PRV', t.agent, 'editor');
    const file = await uploadAttachment(t.agent, blobs, 'PRV-1', {
      filename: 'a.txt',
      data: new TextEncoder().encode('hello'),
    });
    await revoke('PRV', t.member);
    await expect(getAttachment(t.member, file.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteAttachment(t.member, blobs, file.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await grant(t, 'PRV', t.member, 'viewer');
    expect((await getAttachment(t.member, file.id)).id).toBe(file.id);
    await grant(t, 'PRV', t.member, 'editor');
    await expect(deleteAttachment(t.member, blobs, file.id)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await grant(t, 'PRV', t.member, 'manager');
    expect((await deleteAttachment(t.member, blobs, file.id)).id).toBe(file.id);
  });

  it('needs write on the source issue to delete a link', async () => {
    const { createLink, deleteLink } = await import('./services/links.ts');
    await createIssue(t.ctx, 'PUB', { title: 'second' });
    const link = await createLink(t.ctx, 'PUB-1', { type: 'relates', target: 'PUB-2' });
    await revoke('PUB', t.member);
    await expect(deleteLink(t.member, link.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(deleteLink(withActor(t.ctx, ANONYMOUS_ACTOR), link.id)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await grant(t, 'PUB', t.member, 'editor');
    await deleteLink(t.member, link.id);
  });

  it('keeps shared views for managers and personal views for their owners', async () => {
    const { createView, getView, updateView, deleteView } = await import('./services/views.ts');
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    await grant(t, 'PUB', t.member, 'editor');
    await expect(
      createView(t.member, 'PUB', { name: 'Shared', layout: 'list', shared: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await grant(t, 'PUB', t.member, 'manager');
    const shared = await createView(t.member, 'PUB', {
      name: 'Shared',
      layout: 'list',
      shared: true,
    });
    const spare = await createView(t.member, 'PUB', {
      name: 'Spare',
      layout: 'list',
      shared: true,
    });
    // Anyone who can read the project can read a shared view, but not change it.
    expect((await getView(anon, shared.id)).id).toBe(shared.id);
    await expect(updateView(anon, shared.id, { name: 'x' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await grant(t, 'PUB', t.member, 'editor');
    await expect(updateView(t.member, shared.id, { name: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(deleteView(t.member, spare.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await grant(t, 'PUB', t.member, 'manager');
    expect((await updateView(t.member, shared.id, { name: 'Renamed' })).name).toBe('Renamed');
    expect((await deleteView(t.member, spare.id)).id).toBe(spare.id);

    // Personal views belong to the owner, even for managers; readers can make their own.
    await grant(t, 'PUB', t.member, 'viewer');
    const mine = await createView(t.member, 'PUB', { name: 'Mine', layout: 'list' });
    await expect(getView(t.agent, mine.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await updateView(t.member, mine.id, { name: 'Mine 2' })).name).toBe('Mine 2');
    expect((await deleteView(t.member, mine.id)).id).toBe(mine.id);
  });

  it('hides views of unreadable projects and rejects anonymous personal views', async () => {
    const { createView, getView } = await import('./services/views.ts');
    const anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    const hidden = await createView(t.ctx, 'PRV', { name: 'Hidden', layout: 'list', shared: true });
    await revoke('PRV', t.member);
    await expect(getView(t.member, hidden.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(getView(anon, hidden.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createView(anon, 'PRV', { name: 'x', layout: 'list' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(createView(anon, 'PUB', { name: 'x', layout: 'list' })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('treats a parent filter on an unreadable issue as an unknown issue', async () => {
    await revoke('PRV', t.member);
    await expect(
      listIssues(t.member, {
        project: 'PUB',
        filter: { conditions: [{ field: 'parent', op: 'eq', value: 'PRV-1' }] },
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringContaining('Unknown issue'),
    });
  });
});
