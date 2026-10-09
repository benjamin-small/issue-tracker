import { createQuery } from '@tanstack/svelte-query';
import {
  ApiError,
  type CustomField,
  type Label,
  type Status,
  type User,
  type View,
} from './api.ts';
import { type Access, canManage, canWrite, fetchers, isSignedIn, keys } from './queries.ts';

export interface ProjectData {
  readonly key: string;
  readonly statuses: Status[];
  readonly labels: Label[];
  readonly users: User[];
  readonly views: View[];
  /** Active custom field definitions (they also feed the field registry). */
  readonly customFields: CustomField[];
  readonly loaded: boolean;
  /** The caller's level on the project (`myAccess`), once known. */
  readonly access: Access | undefined;
  /** May edit issues, comments, links and attachments. Cosmetic: the server stays the authority. */
  readonly canWrite: boolean;
  /** May change the project's settings. */
  readonly canManage: boolean;
  /** Signed in (not an anonymous visitor). */
  readonly signedIn: boolean;
  /** The project does not exist or is not readable (both are a 404). */
  readonly notFound: boolean;
}

/**
 * Reactive reference data for a project (statuses, labels, users, views, fields), cached by TanStack Query.
 * Project queries wait for a key: global components (command menu, create dialog) mount before one is chosen.
 */
export function useProjectData(key: () => string): ProjectData {
  const me = createQuery(() => ({ queryKey: keys.me, queryFn: fetchers.me, staleTime: 300_000 }));
  const signedIn = $derived(isSignedIn(me.data));
  const project = createQuery(() => ({
    queryKey: keys.project(key()),
    queryFn: () => fetchers.project(key()),
    enabled: !!key(),
  }));
  const statuses = createQuery(() => ({
    queryKey: keys.statuses(key()),
    queryFn: () => fetchers.statuses(key()),
    enabled: !!key(),
  }));
  const labels = createQuery(() => ({
    queryKey: keys.labels(key()),
    queryFn: () => fetchers.labels(key()),
    enabled: !!key(),
  }));
  // The user directory needs sign-in; signed-out visitors see people only as embedded in issues.
  const users = createQuery(() => ({
    queryKey: keys.users,
    queryFn: fetchers.users,
    staleTime: 60_000,
    enabled: signedIn,
  }));
  const views = createQuery(() => ({
    queryKey: keys.views(key()),
    queryFn: () => fetchers.views(key()),
    enabled: !!key(),
  }));
  const fields = createQuery(() => ({
    queryKey: keys.fields(key()),
    queryFn: () => fetchers.fields(key()),
    enabled: !!key(),
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
      // Read every query's status (no short-circuit): TanStack only notifies about result properties that
      // were read, so a status first read after it changed would never update this again.
      const ready = [project, statuses, labels, fields].map((q) => q.isSuccess);
      const people = users.isSuccess || (me.isSuccess && !signedIn);
      return ready.every(Boolean) && people;
    },
    get access() {
      return project.data?.myAccess;
    },
    get canWrite() {
      return canWrite(project.data?.myAccess);
    },
    get canManage() {
      return canManage(project.data?.myAccess);
    },
    get signedIn() {
      return signedIn;
    },
    get notFound() {
      return [project.error, statuses.error].some((e) => e instanceof ApiError && e.status === 404);
    },
  };
}
