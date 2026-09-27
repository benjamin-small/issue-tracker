<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import type { Issue, User } from '../api.ts';
  import { updateIssue } from '../issues.ts';
  import Avatar from './Avatar.svelte';
  import Picker from './Picker.svelte';

  let {
    issue,
    users,
    showLabel = true,
  }: { issue: Issue; users: User[]; showLabel?: boolean } = $props();
  const qc = useQueryClient();
  const NONE = '__none__';
  const items = $derived([
    { value: NONE, label: 'No assignee', user: null },
    ...users
      .filter((u) => !u.deactivatedAt)
      .map((u) => ({ value: u.id, label: u.name, keywords: [u.handle], user: u })),
  ]);

  function select(value: string) {
    const user = users.find((u) => u.id === value) ?? null;
    if ((user?.id ?? null) === issue.assigneeId) return;
    void updateIssue(
      qc,
      issue,
      { assignee: user?.id ?? null },
      {
        assigneeId: user?.id ?? null,
        assignee: user
          ? {
              id: user.id,
              handle: user.handle,
              name: user.name,
              kind: user.kind,
              avatarUrl: user.avatarUrl,
            }
          : null,
      },
    );
  }
</script>

<Picker
  {items}
  selected={[issue.assigneeId ?? NONE]}
  onselect={select}
  triggerLabel="Change assignee"
  testid="assignee-picker"
>
  {#snippet trigger()}
    <Avatar user={issue.assignee} />
    {#if showLabel}<span class="truncate {issue.assignee ? '' : 'text-fg-subtle'}"
        >{issue.assignee?.name ?? 'Unassigned'}</span
      >{/if}
  {/snippet}
  {#snippet item(it)}
    <Avatar user={it.user} />
    <span class="truncate">{it.label}</span>
    {#if it.user}<span class="truncate text-xs text-fg-subtle">@{it.user.handle}</span>{/if}
  {/snippet}
</Picker>
