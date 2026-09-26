<script lang="ts">
  import DOMPurify from 'dompurify';
  import { marked } from 'marked';

  /** Renders markdown safely: marked → DOMPurify (scripts, event handlers and javascript: URLs are stripped). */
  let { source, class: klass = '' }: { source: string; class?: string } = $props();

  const html = $derived(
    DOMPurify.sanitize(marked.parse(source, { gfm: true, breaks: true, async: false }), {
      ADD_ATTR: ['target'],
    }),
  );
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify above -->
<div class="prose-md {klass}">{@html html}</div>
