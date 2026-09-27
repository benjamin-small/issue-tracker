<script lang="ts">
  import Check from '@lucide/svelte/icons/check';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import type { CustomField, Issue, User } from '../api.ts';
  import { shortDate } from '../format.ts';
  import Avatar from './Avatar.svelte';

  /** Read-only rendering of one custom field value (cards, list cells). Unset values render nothing. */
  let { issue, field, users }: { issue: Issue; field: CustomField; users: User[] } = $props();
  const value = $derived(issue.customFields[field.key]);
  const option = (v: unknown) => field.options.find((o) => o.value === v);
  const unit = $derived(typeof field.config.unit === 'string' ? ` ${field.config.unit}` : '');
</script>

{#if value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)}
  <span
    class="inline-flex max-w-full items-center gap-1 text-xs text-fg-muted"
    title={field.name}
    data-cf={field.key}
  >
    {#if field.type === 'select' || field.type === 'multi_select'}
      {#each Array.isArray(value) ? value : [value] as v (v)}
        {@const o = option(v)}
        <span class="inline-flex items-center gap-1 rounded-full border border-border px-1.5">
          <span class="size-2 rounded-full" style:background={o?.color ?? 'var(--color-fg-subtle)'}
          ></span>{o?.label ?? v}
        </span>
      {/each}
    {:else if field.type === 'user'}
      {@const u = users.find((x) => x.id === value) ?? null}
      <Avatar user={u} size={14} />{u?.name ?? '?'}
    {:else if field.type === 'boolean'}
      {#if value}<Check size={12} />{field.name}{:else}<span class="line-through">{field.name}</span
        >{/if}
    {:else if field.type === 'date'}
      {field.name}: {shortDate(String(value))}
    {:else if field.type === 'url'}
      <a
        href={String(value)}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-0.5 text-accent hover:underline"
        >{(() => {
          try {
            return new URL(String(value)).host;
          } catch {
            return String(value);
          }
        })()}<ExternalLink size={10} /></a
      >
    {:else if field.type === 'number'}
      <span class="rounded border border-border px-1">{value}{unit}</span>
    {:else}
      <span class="truncate">{value}</span>
    {/if}
  </span>
{/if}
