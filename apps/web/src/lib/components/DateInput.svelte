<script lang="ts">
  import { type DateValue, getLocalTimeZone, parseDate, today } from '@internationalized/date';
  import CalendarIcon from '@lucide/svelte/icons/calendar';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import { Calendar, Popover } from 'bits-ui';

  /**
   * Date property editor: shows the date (red when overdue, if asked), opens a calendar with quick picks.
   * Value is an ISO day (`2026-10-01`) or null.
   */
  let {
    value,
    onchange,
    label,
    placeholder = 'Set date',
    testid,
    overdue = false,
    disabled = false,
  }: {
    value: string | null;
    onchange: (value: string | null) => void;
    label: string;
    placeholder?: string;
    testid?: string;
    /** Highlight past dates (for due dates). */
    overdue?: boolean;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  const parsed = $derived.by(() => {
    try {
      return value ? parseDate(value) : undefined;
    } catch {
      return undefined;
    }
  });
  const now = $derived(today(getLocalTimeZone()));
  const late = $derived(overdue && !!parsed && parsed.compare(now) < 0);
  const display = $derived(
    parsed
      ? parsed.toDate(getLocalTimeZone()).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: parsed.year === now.year ? undefined : 'numeric',
        })
      : null,
  );

  function set(next: DateValue | undefined) {
    open = false;
    const iso = next ? next.toString() : null;
    if (iso !== value) onchange(iso);
  }

  const quick = $derived([
    { label: 'Today', date: now },
    { label: 'Tomorrow', date: now.add({ days: 1 }) },
    { label: 'In a week', date: now.add({ weeks: 1 }) },
  ]);
</script>

<Popover.Root bind:open>
  <Popover.Trigger
    {disabled}
    class="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-sm hover:bg-bg-hover disabled:hover:bg-transparent {late
      ? 'text-danger'
      : display
        ? ''
        : 'text-fg-subtle'}"
    aria-label={label}
    data-testid={testid}
    data-value={value ?? ''}
  >
    <CalendarIcon size={14} class="shrink-0 {display ? 'opacity-70' : ''}" />
    <span class="truncate">{display ?? placeholder}</span>
  </Popover.Trigger>
  <Popover.Portal>
    <Popover.Content
      sideOffset={4}
      align="start"
      class="z-50 w-64 rounded-lg border border-border bg-bg p-2 text-sm shadow-lg"
    >
      <div class="mb-2 flex flex-wrap gap-1">
        {#each quick as q (q.label)}
          <button
            type="button"
            class="rounded-md border border-border px-2 py-0.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-fg"
            onclick={() => set(q.date)}>{q.label}</button
          >
        {/each}
      </div>
      <Calendar.Root
        type="single"
        value={parsed}
        onValueChange={(v) => v && set(v)}
        weekdayFormat="narrow"
        fixedWeeks
        initialFocus
      >
        {#snippet children({ months, weekdays })}
          <Calendar.Header class="mb-1 flex items-center justify-between">
            <Calendar.PrevButton class="rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
              ><ChevronLeft size={14} /></Calendar.PrevButton
            >
            <Calendar.Heading class="text-sm font-medium" />
            <Calendar.NextButton class="rounded p-1 text-fg-muted hover:bg-bg-hover hover:text-fg"
              ><ChevronRight size={14} /></Calendar.NextButton
            >
          </Calendar.Header>
          {#each months as month (month.value.toString())}
            <Calendar.Grid class="w-full border-collapse">
              <Calendar.GridHead>
                <Calendar.GridRow class="flex">
                  {#each weekdays as day, i (i)}
                    <Calendar.HeadCell class="flex-1 text-center text-xs text-fg-subtle"
                      >{day}</Calendar.HeadCell
                    >
                  {/each}
                </Calendar.GridRow>
              </Calendar.GridHead>
              <Calendar.GridBody>
                {#each month.weeks as week, w (w)}
                  <Calendar.GridRow class="flex">
                    {#each week as date (date.toString())}
                      <Calendar.Cell {date} month={month.value} class="flex-1 p-px text-center">
                        <Calendar.Day
                          class="inline-flex size-8 items-center justify-center rounded-md text-sm hover:bg-bg-hover data-outside-month:text-fg-subtle/60 data-selected:bg-accent data-selected:text-accent-fg data-today:font-semibold data-today:text-accent data-selected:data-today:text-accent-fg"
                        />
                      </Calendar.Cell>
                    {/each}
                  </Calendar.GridRow>
                {/each}
              </Calendar.GridBody>
            </Calendar.Grid>
          {/each}
        {/snippet}
      </Calendar.Root>
      {#if value}
        <div class="mt-1 flex justify-end border-t border-border pt-1.5">
          <button
            type="button"
            class="rounded-md px-2 py-0.5 text-xs text-fg-muted hover:bg-bg-hover hover:text-danger"
            onclick={() => set(undefined)}
            data-testid="date-clear">Clear date</button
          >
        </div>
      {/if}
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
