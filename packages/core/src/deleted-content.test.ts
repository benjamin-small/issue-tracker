import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, type ServiceContext, withActor } from './context.ts';
import { getAttachment, listAttachments, uploadAttachment } from './services/attachments.ts';
import { createComment, deleteComment, listComments } from './services/comments.ts';
import { listIssueLinks } from './services/links.ts';
import {
  createIssue,
  deleteIssue,
  getIssue,
  listChildren,
  listIssueActivity,
  listIssues,
  restoreIssue,
} from './services/issues.ts';
import { createProject } from './services/projects.ts';
import { createUser, toActor } from './services/users.ts';
import { LocalDiskBlobStore } from './storage/blob-store.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';

/**
 * Soft-deleted content (trashed issues, deleted comments and what hangs off them) is visible only to actors with
 * `write` on the project. Readers below that, including anonymous visitors of a public project, never see it.
 */
describe(`deleted content needs write (${testDialect()})`, () => {
  let t: TestContext;
  let anon: ServiceContext;
  let viewer: ServiceContext;
  let editor: ServiceContext;
  let manager: ServiceContext;
  let readers: ServiceContext[];
  let writers: ServiceContext[];
  let deletedCommentId: string;
  let onDeletedComment: string;
  let onTrashedIssue: string;
  const blobs = new LocalDiskBlobStore(join(mkdtempSync(join(tmpdir(), 'del-blobs-')), 'b'));
  const bytes = (s: string) => ({ filename: `${s}.txt`, data: new TextEncoder().encode(s) });

  beforeAll(async () => {
    t = await createTestContext();
    anon = withActor(t.ctx, ANONYMOUS_ACTOR);
    viewer = t.member;
    editor = t.agent;
    manager = withActor(
      t.ctx,
      toActor(await createUser(t.ctx, { handle: 'boss', name: 'Boss', kind: 'human' })),
    );
    readers = [anon, viewer];
    writers = [editor, manager, t.ctx];

    await createProject(t.ctx, { key: 'PUB', name: 'Public', visibility: 'public' });
    await createProject(t.ctx, { key: 'PRV', name: 'Private' });
    await grant(t, 'PUB', viewer, 'viewer');
    await grant(t, 'PUB', editor, 'editor');
    await grant(t, 'PUB', manager, 'manager');
    // In PRV everyone but the admin is a viewer: an editor of PUB must not see PRV's trash.
    for (const who of [viewer, editor, manager]) await grant(t, 'PRV', who, 'viewer');

    await createIssue(t.ctx, 'PUB', { title: 'live' }); // PUB-1
    await createIssue(t.ctx, 'PUB', { title: 'trashed' }); // PUB-2
    await createIssue(t.ctx, 'PUB', { title: 'child of trashed', parent: 'PUB-2' }); // PUB-3
    await createIssue(t.ctx, 'PRV', { title: 'private trashed' }); // PRV-1

    const kept = await createComment(t.ctx, 'PUB-1', { body: 'kept' });
    const gone = await createComment(t.ctx, 'PUB-1', { body: 'gone' });
    deletedCommentId = gone.id;
    onDeletedComment = (
      await uploadAttachment(t.ctx, blobs, 'PUB-1', { ...bytes('c'), commentId: gone.id })
    ).id;
    await uploadAttachment(t.ctx, blobs, 'PUB-1', { ...bytes('k'), commentId: kept.id });
    await deleteComment(t.ctx, gone.id);
    onTrashedIssue = (await uploadAttachment(t.ctx, blobs, 'PUB-2', bytes('t'))).id;
    await createComment(t.ctx, 'PUB-2', { body: 'on trashed' });
    await deleteIssue(t.ctx, 'PUB-2');
    await deleteIssue(t.ctx, 'PRV-1');
  });
  afterAll(() => t.destroy());

  const notFound = { code: 'NOT_FOUND' };

  it('reports a trashed issue as not found to readers below write', async () => {
    for (const who of readers) {
      const name = who.actor.handle;
      await expect(getIssue(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
      const id = (await getIssue(t.ctx, 'PUB-2')).id;
      await expect(getIssue(who, id), name).rejects.toMatchObject(notFound);
      await expect(listComments(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
      await expect(listAttachments(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
      await expect(listChildren(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
      await expect(listIssueLinks(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
      await expect(listIssueActivity(who, 'PUB-2'), name).rejects.toMatchObject(notFound);
    }
    for (const who of writers) {
      const name = who.actor.handle;
      expect((await getIssue(who, 'PUB-2')).deletedAt, name).not.toBeNull();
      expect(
        (await listComments(who, 'PUB-2')).map((c) => c.body),
        name,
      ).toEqual(['on trashed']);
      expect(await listAttachments(who, 'PUB-2'), name).toHaveLength(1);
      expect(
        (await listChildren(who, 'PUB-2')).map((i) => i.key),
        name,
      ).toEqual(['PUB-3']);
    }
  });

  it('a viewer can no more restore a trashed issue than see it; writers still can', async () => {
    await expect(restoreIssue(viewer, 'PUB-2')).rejects.toMatchObject(notFound);
    await expect(deleteIssue(viewer, 'PUB-2')).rejects.toMatchObject(notFound);
    await expect(restoreIssue(anon, 'PUB-2')).rejects.toMatchObject(notFound);
    // A writer re-trashing an issue in the trash is a no-op; restoring and trashing again round-trips.
    expect((await deleteIssue(editor, 'PUB-2')).deletedAt).not.toBeNull();
    expect((await restoreIssue(editor, 'PUB-2')).deletedAt).toBeNull();
    expect((await getIssue(viewer, 'PUB-2')).title).toBe('trashed');
    expect((await deleteIssue(manager, 'PUB-2')).deletedAt).not.toBeNull();
  });

  it('ignores includeDeleted on issue listings for projects the actor cannot write', async () => {
    const keys = async (who: ServiceContext, project?: string) =>
      (await listIssues(who, { project, includeDeleted: true, limit: 200 })).data
        .map((i) => i.key)
        .sort();
    for (const who of readers) {
      expect(await keys(who, 'PUB'), who.actor.handle).toEqual(['PUB-1', 'PUB-3']);
      const all = await keys(who);
      expect(all, who.actor.handle).not.toContain('PUB-2');
      expect(all, who.actor.handle).not.toContain('PRV-1');
    }
    for (const who of [editor, manager]) {
      expect(await keys(who, 'PUB'), who.actor.handle).toEqual(['PUB-1', 'PUB-2', 'PUB-3']);
      // Write on PUB does not reveal PRV's trash, where they only view.
      expect(await keys(who, 'PRV'), who.actor.handle).toEqual([]);
      expect(await keys(who), who.actor.handle).toEqual(['PUB-1', 'PUB-2', 'PUB-3']);
    }
    expect(await keys(t.ctx)).toEqual(['PRV-1', 'PUB-1', 'PUB-2', 'PUB-3']);
    // Text search goes through the same listing.
    const search = (who: ServiceContext) =>
      listIssues(who, {
        includeDeleted: true,
        filter: { conditions: [{ field: 'text', op: 'contains', value: 'trashed' }] },
      });
    expect((await search(viewer)).data.map((i) => i.key)).toEqual(['PUB-3']);
    expect((await search(editor)).data.map((i) => i.key).sort()).toEqual(['PUB-2', 'PUB-3']);
  });

  it('ignores includeDeleted on comments for readers below write', async () => {
    for (const who of readers) {
      const bodies = (await listComments(who, 'PUB-1', { includeDeleted: true })).map(
        (c) => c.body,
      );
      expect(bodies, who.actor.handle).toEqual(['kept']);
    }
    for (const who of writers) {
      const ids = (await listComments(who, 'PUB-1', { includeDeleted: true })).map((c) => c.id);
      expect(ids, who.actor.handle).toContain(deletedCommentId);
    }
  });

  it('hides attachments of trashed issues and deleted comments from readers below write', async () => {
    for (const who of readers) {
      const name = who.actor.handle;
      const listed = (await listAttachments(who, 'PUB-1')).map((a) => a.filename);
      expect(listed, name).toEqual(['k.txt']);
      await expect(getAttachment(who, onDeletedComment), name).rejects.toMatchObject(notFound);
      await expect(getAttachment(who, onTrashedIssue), name).rejects.toMatchObject(notFound);
    }
    for (const who of writers) {
      const name = who.actor.handle;
      const listed = (await listAttachments(who, 'PUB-1')).map((a) => a.filename).sort();
      expect(listed, name).toEqual(['c.txt', 'k.txt']);
      expect((await getAttachment(who, onDeletedComment)).id, name).toBe(onDeletedComment);
      expect((await getAttachment(who, onTrashedIssue)).id, name).toBe(onTrashedIssue);
    }
  });
});
