<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';

  /**
   * Renders markdown safely: marked → DOMPurify (scripts, event handlers and javascript: URLs are stripped).
   * With `ontask`, task-list checkboxes are live and report (index, checked) when toggled.
   */
  let {
    source,
    class: klass = '',
    ontask,
  }: {
    source: string;
    class?: string;
    ontask?: (index: number, checked: boolean) => void;
  } = $props();

  const html = $derived.by(() => {
    const clean = DOMPurify.sanitize(
      marked.parse(source, { gfm: true, breaks: true, async: false }),
      { ADD_ATTR: ['target'] },
    );
    if (!ontask) return clean;
    let index = 0;
    return clean.replace(
      /<input (?:checked="" )?disabled="" type="checkbox"(?: checked="")?>/g,
      (tag) =>
        `<input type="checkbox" data-task="${index++}" aria-label="Toggle task"${tag.includes('checked') ? ' checked=""' : ''}>`,
    );
  });

  function onchange(event: Event) {
    const box = event.target as HTMLInputElement;
    if (!ontask || box.dataset.task === undefined) return;
    ontask(Number(box.dataset.task), box.checked);
  }
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify above -->
<div class="prose-md {klass}" {onchange}>{@html html}</div>
