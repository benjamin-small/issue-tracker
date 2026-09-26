import type { QueryClient } from '@tanstack/svelte-query';
import { attachmentMarkdown, uploadAttachment } from './api.ts';
import { keys } from './queries.ts';

/** An upload handler for MarkdownEditor: uploads to the issue and returns the markdown to insert. */
export function markdownUploader(qc: QueryClient, issueKey: () => string) {
  return async (file: File): Promise<string> => {
    const attachment = await uploadAttachment(issueKey(), file);
    void qc.invalidateQueries({ queryKey: keys.attachments(issueKey()) });
    return attachmentMarkdown(attachment);
  };
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
