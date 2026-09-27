<script lang="ts">
  import { useQueryClient } from '@tanstack/svelte-query';
  import { Dialog } from 'bits-ui';
  import X from '@lucide/svelte/icons/x';
  import { api, call, errorMessage } from '../api.ts';
  import { navigate } from '../nav.ts';
  import { keys } from '../queries.ts';
  import { toast } from '../toast.svelte.ts';
  import { ui } from '../ui.svelte.ts';

  /** Creates a project. The key prefixes every issue ID (ENG-42), so it is fixed once chosen. */
  const qc = useQueryClient();
  let name = $state('');
  let key = $state('');
  let keyEdited = $state(false);
  let description = $state('');
  let error = $state('');
  let busy = $state(false);

  /** "Mobile App" → "MA", "Engineering" → "ENG". */
  function suggestKey(value: string): string {
    const words = value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];
    if (words.length === 0) return '';
    const raw =
      words.length === 1
        ? words[0]!.slice(0, 3)
        : words
            .map((w) => w[0])
            .join('')
            .slice(0, 5);
    return /^[A-Z]/.test(raw) ? raw : `P${raw}`.slice(0, 5);
  }

  $effect(() => {
    if (!keyEdited) key = suggestKey(name);
  });

  const keyValid = $derived(/^[A-Z][A-Z0-9]{1,9}$/.test(key));

  function close() {
    ui.createProject = false;
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim() || !keyValid || busy) return;
    busy = true;
    error = '';
    try {
      const project = await call(
        api.POST('/projects', {
          body: { key, name: name.trim(), description: description.trim() },
        }),
      );
      await qc.invalidateQueries({ queryKey: keys.projects });
      close();
      toast(`Created ${project.name}`, 'success');
      await navigate(`/p/${project.key}`);
    } catch (e) {
      error = errorMessage(e);
    } finally {
      busy = false;
    }
  }

  const input =
    'w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent';
</script>

<Dialog.Root open={ui.createProject} onOpenChange={(open) => !open && close()}>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-40 bg-black/30" />
    <Dialog.Content
      class="fixed top-[12vh] left-1/2 z-50 w-[min(480px,92vw)] -translate-x-1/2 rounded-xl border border-border bg-bg shadow-2xl"
      data-testid="create-project-dialog"
    >
      <form onsubmit={submit}>
        <div class="flex items-center border-b border-border px-4 py-3">
          <Dialog.Title class="font-semibold">New project</Dialog.Title>
          <Dialog.Close class="ml-auto rounded p-1 hover:bg-bg-hover" aria-label="Close"
            ><X size={15} /></Dialog.Close
          >
        </div>
        <div class="space-y-4 px-4 py-4">
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-fg-muted">Name</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class={input}
              bind:value={name}
              placeholder="Engineering"
              autofocus
              data-testid="project-name"
            />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-fg-muted">Key</span>
            <input
              class="{input} font-mono uppercase"
              value={key}
              oninput={(e) => {
                keyEdited = true;
                key = e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
              }}
              maxlength="10"
              placeholder="ENG"
              data-testid="project-key"
            />
            <span class="mt-1 block text-xs {key && !keyValid ? 'text-danger' : 'text-fg-subtle'}">
              {#if key && !keyValid}
                2–10 letters or digits, starting with a letter.
              {:else}
                Issue IDs will look like <span class="font-mono">{key || 'ENG'}-1</span>. The key
                can't be changed later.
              {/if}
            </span>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs font-medium text-fg-muted"
              >Description <span class="font-normal text-fg-subtle">(optional)</span></span
            >
            <textarea class="{input} resize-y" rows="2" bind:value={description}></textarea>
          </label>
          {#if error}<p class="text-sm text-danger" role="alert">{error}</p>{/if}
        </div>
        <div class="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm hover:bg-bg-hover"
            onclick={close}>Cancel</button
          >
          <button
            type="submit"
            class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
            disabled={!name.trim() || !keyValid || busy}
            data-testid="create-project-submit">Create project</button
          >
        </div>
      </form>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
