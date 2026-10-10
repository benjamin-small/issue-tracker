import type { QueryClient } from '@tanstack/svelte-query';
import {
  compareIssues,
  FieldRegistry,
  type IssueFilter,
  matchesFilter,
  type SortSpec,
} from '@poietic-tech/issues-schema';
import { type Issue, ownRequestIds, type TrackerEvent } from './api.ts';
import { projectKeyOf } from './issues.ts';
import { type IssueListQuery, isSignedIn, keys, type Me } from './queries.ts';

/** Connection state, shown in the UI. */
export const live = $state({ connected: false });

type IssueRef = { id: string; key: string };

/**
 * Applies an issue snapshot from a live event to every cached query: the detail cache, and each cached list —
 * inserting, updating or removing the issue according to that list's filter (`matchesFilter`, the same
 * semantics as the server) and re-sorting with the list's sort.
 */
export function applyIssueSnapshot(
  qc: QueryClient,
  issue: Issue,
  meId: string | undefined,
  registry = new FieldRegistry(),
) {
  qc.setQueryData(keys.issue(issue.key), issue);
  for (const [key, list] of qc.getQueriesData<Issue[]>({
    queryKey: keys.issueLists(projectKeyOf(issue.key)),
  })) {
    if (!list) continue;
    const query = key[2] as IssueListQuery | undefined;
    if (!query) continue;
    const belongs =
      (query.includeDeleted || issue.deletedAt === null) &&
      matchesFilter(issue as never, query.filter as IssueFilter, { meId: meId ?? null, registry });
    const without = list.filter((i) => i.id !== issue.id);
    const next = belongs
      ? [...without, issue].sort(compareIssues(query.sort as SortSpec[]) as never)
      : without;
    if (belongs || without.length !== list.length) qc.setQueryData(key, next);
  }
}

function handle(qc: QueryClient, event: TrackerEvent, meId: string | undefined) {
  const data = event.data as {
    requestId?: string;
    issue?: Issue | IssueRef;
    link?: { source: IssueRef; target: IssueRef };
  };
  const own = data.requestId !== undefined && ownRequestIds.has(data.requestId);

  if (event.type.startsWith('issue.') && data.issue && 'status' in data.issue) {
    const issue = data.issue;
    if (!own) applyIssueSnapshot(qc, issue, meId);
    void qc.invalidateQueries({ queryKey: keys.activity(issue.key) });
    void qc.invalidateQueries({ queryKey: ['children'] });
    return;
  }
  if (event.type.startsWith('comment.') && data.issue) {
    if (!own) void qc.invalidateQueries({ queryKey: keys.comments(data.issue.key) });
    void qc.invalidateQueries({ queryKey: keys.issue(data.issue.key) }); // comment count
    void qc.invalidateQueries({ queryKey: keys.activity(data.issue.key) });
    return;
  }
  if (event.type.startsWith('attachment.') && data.issue) {
    void qc.invalidateQueries({ queryKey: keys.attachments(data.issue.key) });
    void qc.invalidateQueries({ queryKey: keys.activity(data.issue.key) });
    return;
  }
  if (event.type.startsWith('link.') && data.link) {
    for (const ref of [data.link.source, data.link.target]) {
      void qc.invalidateQueries({ queryKey: keys.links(ref.key) });
      void qc.invalidateQueries({ queryKey: keys.activity(ref.key) });
    }
    return;
  }
  // Membership changed: the viewer's own level (`myAccess`) may differ, so refetch it (the controls that depend on
  // it follow) and the members list. Nothing else about the project changed.
  if (event.type.startsWith('project.member_')) {
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: keys.projects });
    void qc.invalidateQueries({ queryKey: ['members'] });
    return;
  }
  // Workflow, labels, projects, users: reference data changed (and issue snapshots embed some of it).
  if (
    event.type.startsWith('status.') ||
    event.type.startsWith('label.') ||
    event.type.startsWith('project.')
  ) {
    void qc.invalidateQueries({ queryKey: ['statuses'] });
    void qc.invalidateQueries({ queryKey: ['labels'] });
    void qc.invalidateQueries({ queryKey: keys.projects });
    void qc.invalidateQueries({ queryKey: ['project'] });
    void qc.invalidateQueries({ queryKey: ['issues'] });
    // A visibility change can change the viewer's level too (the project and projects refetch above).
    if (event.type === 'project.updated') void qc.invalidateQueries({ queryKey: ['members'] });
    // Issues that named an unlinked repo lose it, open issue pages included.
    if (event.type === 'project.repo_removed') void qc.invalidateQueries({ queryKey: ['issue'] });
  } else if (event.type.startsWith('field.')) {
    // Field definitions changed: refetch them and anything embedding custom field values.
    void qc.invalidateQueries({ queryKey: ['fields'] });
    void qc.invalidateQueries({ queryKey: ['issues'] });
    void qc.invalidateQueries({ queryKey: ['issue'] });
  } else if (event.type.startsWith('user.')) {
    void qc.invalidateQueries({ queryKey: keys.users });
  }
}

/**
 * Subscribes to live events for a project over SSE (cookie-authenticated, same origin; signed-out visitors get
 * the public projects' events, filtered by the server). The browser reconnects
 * automatically and resumes with Last-Event-ID; a `reset` means the gap was too large, so everything refetches.
 * Returns a function that closes the connection.
 */
export function connectLive(qc: QueryClient, projectKey: string): () => void {
  if (typeof EventSource === 'undefined' || !projectKey) return () => {};
  const source = new EventSource(`/api/v1/events/stream?project=${encodeURIComponent(projectKey)}`);
  const meId = () => {
    const me = qc.getQueryData<Me>(keys.me);
    return isSignedIn(me) ? me.id : undefined;
  };
  let opened = false;

  source.addEventListener('ready', () => {
    live.connected = true;
    // After a reconnect we may have missed updates made while offline: refresh lists once.
    if (opened) void qc.invalidateQueries({ queryKey: keys.issueLists(projectKey) });
    opened = true;
  });
  source.addEventListener('reset', () => void qc.invalidateQueries());
  // The server is restarting; the browser reconnects on its own (and replays from Last-Event-ID).
  source.addEventListener('shutdown', () => (live.connected = false));
  source.onerror = () => {
    live.connected = false;
  };
  source.onmessage = () => {};
  const onEvent = (message: MessageEvent<string>) => {
    try {
      handle(qc, JSON.parse(message.data) as TrackerEvent, meId());
    } catch (error) {
      console.error('live event failed', error);
    }
  };
  for (const type of [
    'issue.created',
    'issue.updated',
    'issue.deleted',
    'issue.restored',
    'comment.created',
    'comment.updated',
    'comment.deleted',
    'link.created',
    'link.deleted',
    'attachment.created',
    'attachment.deleted',
    'project.created',
    'project.updated',
    'project.member_added',
    'project.member_changed',
    'project.member_removed',
    'project.repo_added',
    'project.repo_removed',
    'status.created',
    'status.updated',
    'status.deleted',
    'label.created',
    'label.updated',
    'label.deleted',
    'user.created',
    'user.updated',
    'field.created',
    'field.updated',
    'field.deleted',
  ])
    source.addEventListener(type, onEvent);

  return () => {
    source.close();
    live.connected = false;
  };
}
