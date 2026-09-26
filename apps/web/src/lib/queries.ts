import type { IssueFilter, SortSpec } from '@tracker/schema';
import { api, call, type Issue } from './api.ts';

/** Query keys. Issues are cached by key (`ENG-42`), lists by project + query. */
export const keys = {
  me: ['me'] as const,
  authConfig: ['auth-config'] as const,
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  statuses: (key: string) => ['statuses', key] as const,
  labels: (key: string) => ['labels', key] as const,
  views: (key: string) => ['views', key] as const,
  users: ['users'] as const,
  linkTypes: ['link-types'] as const,
  fields: (key: string) => ['fields', key] as const,
  issueLists: (project: string) => ['issues', project] as const,
  issueList: (project: string, query: IssueListQuery) => ['issues', project, query] as const,
  issue: (key: string) => ['issue', key] as const,
  comments: (key: string) => ['comments', key] as const,
  links: (key: string) => ['links', key] as const,
  attachments: (key: string) => ['attachments', key] as const,
  children: (key: string) => ['children', key] as const,
  activity: (key: string) => ['activity', key] as const,
  webhooks: ['webhooks'] as const,
  deliveries: (id: string) => ['webhooks', id, 'deliveries'] as const,
};

export interface IssueListQuery {
  filter: IssueFilter;
  sort: SortSpec[];
  includeDeleted?: boolean;
}

export const fetchers = {
  me: () => call(api.GET('/me')),
  authConfig: () => call(api.GET('/auth/config')),
  projects: async () => (await call(api.GET('/projects', { params: { query: {} } }))).data,
  project: (key: string) =>
    call(api.GET('/projects/{project}', { params: { path: { project: key } } })),
  statuses: async (key: string) =>
    (await call(api.GET('/projects/{project}/statuses', { params: { path: { project: key } } })))
      .data,
  labels: async (key: string) =>
    (await call(api.GET('/projects/{project}/labels', { params: { path: { project: key } } })))
      .data,
  views: async (key: string) =>
    (await call(api.GET('/projects/{project}/views', { params: { path: { project: key } } }))).data,
  users: async () => (await call(api.GET('/users', { params: { query: {} } }))).data,
  linkTypes: async () => (await call(api.GET('/link-types'))).data,
  fields: async (key: string) =>
    (
      await call(
        api.GET('/projects/{project}/fields', { params: { path: { project: key }, query: {} } }),
      )
    ).data,
  /** Every issue matching a query (pages through the results; views show whole projects). */
  issues: async (project: string, query: IssueListQuery): Promise<Issue[]> => {
    const all: Issue[] = [];
    let cursor: string | null = null;
    do {
      const page: { data: Issue[]; nextCursor: string | null } = await call(
        api.POST('/issues/search', {
          body: {
            project,
            filter: query.filter,
            sort: query.sort,
            limit: 200,
            includeDeleted: query.includeDeleted ?? false,
            ...(cursor && { cursor }),
          },
        }),
      );
      all.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor && all.length < 5000);
    return all;
  },
  issue: (key: string) => call(api.GET('/issues/{issue}', { params: { path: { issue: key } } })),
  comments: async (key: string) =>
    (
      await call(
        api.GET('/issues/{issue}/comments', { params: { path: { issue: key }, query: {} } }),
      )
    ).data,
  attachments: async (key: string) =>
    (await call(api.GET('/issues/{issue}/attachments', { params: { path: { issue: key } } }))).data,
  links: async (key: string) =>
    (await call(api.GET('/issues/{issue}/links', { params: { path: { issue: key } } }))).data,
  children: async (key: string) =>
    (await call(api.GET('/issues/{issue}/children', { params: { path: { issue: key } } }))).data,
  activity: async (key: string) =>
    (
      await call(
        api.GET('/issues/{issue}/activity', {
          params: { path: { issue: key }, query: { limit: 200 } },
        }),
      )
    ).data,
};
