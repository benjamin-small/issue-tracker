import { createQuery } from '@tanstack/svelte-query';
import type { CustomField, Label, Status, User, View } from './api.ts';
import { fetchers, keys } from './queries.ts';

export interface ProjectData {
  readonly key: string;
  readonly statuses: Status[];
  readonly labels: Label[];
  readonly users: User[];
  readonly views: View[];
  /** Active custom field definitions (they also feed the field registry). */
  readonly customFields: CustomField[];
  readonly loaded: boolean;
}

/** Reactive reference data for a project (statuses, labels, users, views, fields), cached by TanStack Query. */
export function useProjectData(key: () => string): ProjectData {
  const statuses = createQuery(() => ({
    queryKey: keys.statuses(key()),
    queryFn: () => fetchers.statuses(key()),
  }));
  const labels = createQuery(() => ({
    queryKey: keys.labels(key()),
    queryFn: () => fetchers.labels(key()),
  }));
  const users = createQuery(() => ({
    queryKey: keys.users,
    queryFn: fetchers.users,
    staleTime: 60_000,
  }));
  const views = createQuery(() => ({
    queryKey: keys.views(key()),
    queryFn: () => fetchers.views(key()),
  }));
  const fields = createQuery(() => ({
    queryKey: keys.fields(key()),
    queryFn: () => fetchers.fields(key()),
  }));
  return {
    get key() {
      return key();
    },
    get statuses() {
      return statuses.data ?? [];
    },
    get labels() {
      return labels.data ?? [];
    },
    get users() {
      return users.data ?? [];
    },
    get views() {
      return views.data ?? [];
    },
    get customFields() {
      return fields.data ?? [];
    },
    get loaded() {
      return statuses.isSuccess && labels.isSuccess && users.isSuccess && fields.isSuccess;
    },
  };
}
