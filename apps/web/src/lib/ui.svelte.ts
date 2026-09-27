/** Global UI state (dialogs and panels opened from anywhere, e.g. keyboard shortcuts). */
export const ui = $state({
  createIssue: {
    open: false,
    project: '' as string,
    status: undefined as string | undefined,
    parent: undefined as string | undefined,
  },
  createProject: false,
  /** The navigation drawer on narrow screens (always visible from the md breakpoint up). */
  sidebarOpen: false,
});

export function openCreateIssue(project: string, opts: { status?: string; parent?: string } = {}) {
  ui.createIssue = { open: true, project, status: opts.status, parent: opts.parent };
}
