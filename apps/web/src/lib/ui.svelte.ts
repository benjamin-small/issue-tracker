/** Global UI state (dialogs and panels opened from anywhere, e.g. keyboard shortcuts). */
export type CommandMode = 'root' | 'status' | 'assignee' | 'priority' | 'labels';

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
  command: {
    open: false,
    mode: 'root' as CommandMode,
    /** Issue keys the menu's issue actions apply to (empty: none in context). */
    targets: [] as string[],
  },
  shortcutsOpen: false,
  /** The issue shown in the peek panel or on the issue page, if any (a target for issue shortcuts). */
  openIssue: null as string | null,
  /** Opens an issue from the current view (set by the project view: peek panel; default: issue page). */
  opener: null as ((key: string) => void) | null,
});

export function openCreateIssue(project: string, opts: { status?: string; parent?: string } = {}) {
  ui.createIssue = { open: true, project, status: opts.status, parent: opts.parent };
}

export function openCommand(mode: CommandMode = 'root', targets: string[] = []) {
  ui.command = { open: true, mode, targets };
}
