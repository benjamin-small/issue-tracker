import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDialect } from '@poietic-tech/issues-db/testing';
import { ANONYMOUS_ACTOR, type ServiceContext, withActor } from './context.ts';
import {
  deleteAttachment,
  getAttachment,
  listAttachments,
  uploadAttachment,
} from './services/attachments.ts';
import { createComment, deleteComment, listComments, updateComment } from './services/comments.ts';
import { filterEventsForViewer, listEvents } from './services/events.ts';
import { createLink, deleteLink, listIssueLinks } from './services/links.ts';
import {
  createIssue,
  deleteIssue,
  getIssue,
  listChildren,
  listIssueActivity,
  listIssues,
  restoreIssue,
  updateIssue,
} from './services/issues.ts';
import type { TrackerEvent } from '@poietic-tech/issues-schema';
import { SYSTEM_ACTOR } from './context.ts';
import { createProject } from './services/projects.ts';
import { createUser, toActor } from './services/users.ts';
import { LocalDiskBlobStore } from './storage/blob-store.ts';
import { createTestContext, grant, type TestContext } from './testing.ts';
import { hideTrashedParents } from './issue-query.ts';

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
  let commentOnTrashed: string;
  let removedAttachment: string;
  const blobDir = mkdtempSync(join(tmpdir(), 'del-blobs-'));
  const blobs = new LocalDiskBlobStore(join(blobDir, 'b'));
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
    await createIssue(t.ctx, 'PUB', { title: 'reparented' }); // PUB-4
    await updateIssue(t.ctx, 'PUB-4', { parent: 'PUB-2' }); // changes.parent names PUB-2
    await createLink(t.ctx, 'PUB-1', { type: 'relates', target: 'PUB-2' });

    const kept = await createComment(t.ctx, 'PUB-1', { body: 'kept' });
    const gone = await createComment(t.ctx, 'PUB-1', { body: 'gone' });
    deletedCommentId = gone.id;
    onDeletedComment = (
      await uploadAttachment(t.ctx, blobs, 'PUB-1', { ...bytes('c'), commentId: gone.id })
    ).id;
    await uploadAttachment(t.ctx, blobs, 'PUB-1', { ...bytes('k'), commentId: kept.id });
    await deleteComment(t.ctx, gone.id);
    removedAttachment = (await uploadAttachment(t.ctx, blobs, 'PUB-1', bytes('r'))).id;
    await deleteAttachment(t.ctx, blobs, removedAttachment);
    onTrashedIssue = (await uploadAttachment(t.ctx, blobs, 'PUB-2', bytes('t'))).id;
    commentOnTrashed = (await createComment(t.ctx, 'PUB-2', { body: 'on trashed' })).id;
    await deleteIssue(t.ctx, 'PUB-2');
    await deleteIssue(t.ctx, 'PRV-1');
  });
  afterAll(async () => {
    await t.destroy();
    rmSync(blobDir, { recursive: true, force: true });
  });

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
      expect((await listChildren(who, 'PUB-2')).map((i) => i.key).sort(), name).toEqual([
        'PUB-3',
        'PUB-4',
      ]);
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
      expect(await keys(who, 'PUB'), who.actor.handle).toEqual(['PUB-1', 'PUB-3', 'PUB-4']);
      const all = await keys(who);
      expect(all, who.actor.handle).not.toContain('PUB-2');
      expect(all, who.actor.handle).not.toContain('PRV-1');
    }
    for (const who of [editor, manager]) {
      expect(await keys(who, 'PUB'), who.actor.handle).toEqual([
        'PUB-1',
        'PUB-2',
        'PUB-3',
        'PUB-4',
      ]);
      // Write on PUB does not reveal PRV's trash, where they only view.
      expect(await keys(who, 'PRV'), who.actor.handle).toEqual([]);
      expect(await keys(who), who.actor.handle).toEqual(['PUB-1', 'PUB-2', 'PUB-3', 'PUB-4']);
    }
    expect(await keys(t.ctx)).toEqual(['PRV-1', 'PUB-1', 'PUB-2', 'PUB-3', 'PUB-4']);
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
      expect(listed, name).toEqual(['c.txt', 'k.txt']); // r.txt is deleted for everyone
      expect((await getAttachment(who, onDeletedComment)).id, name).toBe(onDeletedComment);
      expect((await getAttachment(who, onTrashedIssue)).id, name).toBe(onTrashedIssue);
    }
  });

  it('cuts a trashed parent out of its live children for readers below write', async () => {
    for (const who of readers) {
      const name = who.actor.handle;
      for (const issue of [
        await getIssue(who, 'PUB-3'),
        (await listIssues(who, { project: 'PUB' })).data.find((i) => i.key === 'PUB-3')!,
        (await listIssues(who, {})).data.find((i) => i.key === 'PUB-3')!,
      ]) {
        expect(issue.parent, name).toBeNull();
        expect(issue.parentId, name).toBeNull();
      }
    }
    for (const who of writers) {
      const issue = await getIssue(who, 'PUB-3');
      expect(issue.parent, who.actor.handle).toMatchObject({ key: 'PUB-2', title: 'trashed' });
      const listed = (await listIssues(who, { project: 'PUB' })).data.find(
        (i) => i.key === 'PUB-3',
      );
      expect(listed!.parent?.key, who.actor.handle).toBe('PUB-2');
    }
  });

  it('leaves parents alone for unrestricted actors without querying', async () => {
    const child = await getIssue(t.ctx, 'PUB-3');
    const noDb = new Proxy({} as never, {
      get: () => {
        throw new Error('hideTrashedParents queried the database');
      },
    });
    for (const who of [t.ctx, withActor(t.ctx, SYSTEM_ACTOR)])
      expect(await hideTrashedParents(who, noDb, [child])).toEqual([child]);
  });

  describe('in the event log', () => {
    let trashedId: string;
    let allEvents: TrackerEvent[];
    beforeAll(async () => {
      trashedId = (await getIssue(t.ctx, 'PUB-2')).id;
      allEvents = (await listEvents(withActor(t.ctx, SYSTEM_ACTOR), { limit: 1000 })).data;
    });

    const commentEvents = (events: TrackerEvent[], id: string) =>
      events.filter(
        (e) => e.type.startsWith('comment.') && (e.data.comment as { id: string }).id === id,
      );
    const attachmentIds = (events: TrackerEvent[]) =>
      events
        .filter((e) => e.type.startsWith('attachment.'))
        .map((e) => (e.data.attachment as { id: string }).id);
    const names = (events: TrackerEvent[], issueId: string) =>
      events.some((e) => e.issueId === issueId || JSON.stringify(e.data).includes(issueId));

    /** What a reader below write may see of the fixture's deleted content: nothing but deletion markers. */
    function expectNoDeletedContent(events: TrackerEvent[], name: string) {
      expect(names(events, trashedId), name).toBe(false);
      const json = JSON.stringify(events);
      for (const secret of ['"trashed"', '"gone"', '"on trashed"', 'c.txt', 't.txt', 'r.txt'])
        expect(json, `${name} ${secret}`).not.toContain(secret);
      // The deleted comment keeps its events, without the text.
      const gone = commentEvents(events, deletedCommentId);
      expect(
        gone.map((e) => e.type),
        name,
      ).toEqual(['comment.created', 'comment.deleted']);
      for (const e of gone) expect((e.data.comment as { body: string }).body, name).toBe('');
      expect(attachmentIds(events), name).not.toContain(onDeletedComment);
      expect(attachmentIds(events), name).not.toContain(onTrashedIssue);
      expect(attachmentIds(events), name).not.toContain(removedAttachment);
      expect(
        events.some((e) => e.type.startsWith('link.')),
        name,
      ).toBe(false);
    }

    it('hides deleted content from readers in GET /events, and matches the live filter', async () => {
      for (const who of readers) {
        const name = who.actor.handle;
        const listed = (await listEvents(who, { limit: 1000 })).data;
        expect(listed.length, name).toBeGreaterThan(0);
        expectNoDeletedContent(listed, name);
        // The kept comment and live issues are untouched.
        expect(JSON.stringify(listed), name).toContain('"kept"');
        const child = listed.find(
          (e) => e.type === 'issue.created' && (e.data.issue as { key: string }).key === 'PUB-3',
        )!;
        expect((child.data.issue as { parent: unknown }).parent, name).toBeNull();
        const reparent = listed.find(
          (e) => e.type === 'issue.updated' && (e.data.issue as { key: string }).key === 'PUB-4',
        )!;
        // The parent change names the trashed PUB-2, so it is left out rather than read as "removed the parent".
        expect(reparent.data.changes, name).toEqual({});
        // Other changes in the same event stay.
        const original = allEvents.find((e) => e.id === reparent.id)!;
        const [mixed] = await filterEventsForViewer(who, [
          {
            ...original,
            data: {
              ...original.data,
              changes: { ...original.data.changes!, title: { from: 'a', to: 'b' } },
            },
          },
        ]);
        expect(mixed!.data.changes, name).toEqual({ title: { from: 'a', to: 'b' } });
        // Live and replay apply the same rules.
        expect(await filterEventsForViewer(who, allEvents), name).toEqual(listed);
      }
    });

    it('hides deleted content from readers in issue activity', async () => {
      for (const who of readers) {
        const activity = (await listIssueActivity(who, 'PUB-1')).data;
        expectNoDeletedContent(activity, who.actor.handle);
        expect(
          activity.some((e) => e.type === 'issue.created'),
          who.actor.handle,
        ).toBe(true);
      }
    });

    it('shows writers everything in their projects, and only there', async () => {
      for (const who of [editor, manager]) {
        const name = who.actor.handle;
        const listed = (await listEvents(who, { limit: 1000 })).data;
        expect(names(listed, trashedId), name).toBe(true);
        const gone = commentEvents(listed, deletedCommentId);
        expect(
          gone.map((e) => (e.data.comment as { body: string }).body),
          name,
        ).toEqual(['gone', 'gone']);
        expect(attachmentIds(listed), name).toEqual(
          expect.arrayContaining([onDeletedComment, onTrashedIssue, removedAttachment]),
        );
        expect(
          listed.some((e) => e.type === 'link.created'),
          name,
        ).toBe(true);
        expect(await filterEventsForViewer(who, allEvents), name).toEqual(listed);
        const activity = (await listIssueActivity(who, 'PUB-1')).data;
        expect(
          activity.some((e) => e.type === 'link.created'),
          name,
        ).toBe(true);
        // In PRV they only view: its trashed issue stays hidden.
        const prv = (await getIssue(t.ctx, 'PRV-1')).id;
        expect(names(listed, prv), name).toBe(false);
      }
      const admin = (await listEvents(t.ctx, { limit: 1000 })).data;
      expect(admin).toEqual(allEvents);
    });
  });

  // Runs last: it writes, and the event log tests above compare against a snapshot.
  it("treats changes to a trashed issue's comments, attachments and links as not found below write", async () => {
    // Link lists leave out links to trashed issues; the link's id is in its event.
    const linkToTrashed = (
      (await listEvents(t.ctx, { types: ['link.created'] })).data[0]!.data.link as { id: string }
    ).id;
    for (const who of readers) {
      const name = who.actor.handle;
      await expect(deleteLink(who, linkToTrashed), name).rejects.toMatchObject(notFound);
      await expect(updateComment(who, commentOnTrashed, { body: 'x' }), name).rejects.toMatchObject(
        notFound,
      );
      await expect(deleteComment(who, commentOnTrashed), name).rejects.toMatchObject(notFound);
      await expect(deleteAttachment(who, blobs, onTrashedIssue), name).rejects.toMatchObject(
        notFound,
      );
      // An attachment of a deleted comment is just as absent.
      await expect(deleteAttachment(who, blobs, onDeletedComment), name).rejects.toMatchObject(
        notFound,
      );
    }
    // Writers still can (the manager may change others' comments and attachments).
    expect((await updateComment(manager, commentOnTrashed, { body: 'edited' })).body).toBe(
      'edited',
    );
    expect((await deleteComment(manager, commentOnTrashed)).deletedAt).not.toBeNull();
    expect((await deleteAttachment(manager, blobs, onTrashedIssue)).deletedAt).not.toBeNull();
    await deleteLink(editor, linkToTrashed);
    expect((await listEvents(t.ctx, { types: ['link.deleted'] })).data).toHaveLength(1);
  });

  // Writes too, in a project of its own.
  it('keeps a move from a trashed parent to a live one as { from: null, to } below write', async () => {
    const project = await createProject(t.ctx, {
      key: 'REP',
      name: 'Reparent',
      visibility: 'public',
    });
    await grant(t, 'REP', viewer, 'viewer');
    await grant(t, 'REP', editor, 'editor');
    const old = await createIssue(t.ctx, 'REP', { title: 'old parent' });
    const next = await createIssue(t.ctx, 'REP', { title: 'new parent' });
    const moved = await createIssue(t.ctx, 'REP', { title: 'moved', parent: old.key });
    const orphaned = await createIssue(t.ctx, 'REP', { title: 'orphaned', parent: old.key });
    const adopted = await createIssue(t.ctx, 'REP', { title: 'adopted' });
    await updateIssue(t.ctx, moved.key, { parent: next.key });
    await updateIssue(t.ctx, orphaned.key, { parent: null });
    await updateIssue(t.ctx, adopted.key, { parent: old.key });
    await deleteIssue(t.ctx, old.key);

    /** `changes` of the one `issue.updated` event of `key`, as `who` sees it in the log and in the activity. */
    const changesOf = async (who: ServiceContext, key: string) => {
      const listed = (
        await listEvents(who, { project: project.id, types: ['issue.updated'] })
      ).data.filter((e) => (e.data.issue as { key: string }).key === key);
      expect(listed, `${who.actor.handle} ${key}`).toHaveLength(1);
      const activity = (await listIssueActivity(who, key)).data.filter(
        (e) => e.type === 'issue.updated',
      );
      expect(activity.map((e) => e.data.changes)).toEqual([listed[0]!.data.changes]);
      return listed[0]!.data.changes;
    };
    const ref = (issue: { id: string; key: string }) =>
      expect.objectContaining({ id: issue.id, key: issue.key });
    for (const who of readers) {
      // The live end of the move stays; the trashed one is cut.
      expect(await changesOf(who, moved.key)).toEqual({ parent: { from: null, to: ref(next) } });
      // From a trashed parent to none, or to a trashed one, there is nothing left to tell.
      expect(await changesOf(who, orphaned.key)).toEqual({});
      expect(await changesOf(who, adopted.key)).toEqual({});
    }
    expect(await changesOf(editor, moved.key)).toEqual({
      parent: { from: ref(old), to: ref(next) },
    });
    expect(await changesOf(editor, orphaned.key)).toEqual({ parent: { from: ref(old), to: null } });
  });
});
