import { ApiError, createClient, type Schemas, unwrap } from '@poietic-tech/issues-client';

export type Issue = Schemas['Issue'];
export type Status = Schemas['Status'];
export type Label = Schemas['Label'];
export type User = Schemas['User'];
export type Project = Schemas['ProjectWithAccess'];
export type View = Schemas['View'];
export type ViewConfig = Schemas['ViewConfig'];
export type Comment = Schemas['Comment'];
export type IssueLink = Schemas['IssueLink'];
export type TrackerEvent = Schemas['Event'];
export type LinkType = Schemas['LinkType'];
export type CustomField = Schemas['CustomField'];
export type Attachment = Schemas['Attachment'];
export type Webhook = Schemas['Webhook'];
export type WebhookDelivery = Schemas['WebhookDelivery'];
export type UpdateIssueInput = Schemas['UpdateIssueInput'];
export type CreateIssueInput = Schemas['CreateIssueInput'];
export { ApiError };

const MAX_OWN_IDS = 500;
/** Request ids this tab generated — live events carrying one of them are echoes of our own writes. */
export const ownRequestIds = new Set<string>();

function requestId(): string {
  const id = `web_${crypto.randomUUID()}`;
  ownRequestIds.add(id);
  if (ownRequestIds.size > MAX_OWN_IDS) ownRequestIds.delete(ownRequestIds.values().next().value!);
  return id;
}

/** Typed client for the same-origin API; authenticates with the session cookie. */
export const api = createClient({
  baseUrl: typeof location === 'undefined' ? 'http://localhost' : location.origin,
  requestId,
  fetch: (request) => fetch(request, { credentials: 'same-origin' }),
});

let onUnauthenticated: (() => void) | undefined;
export function setUnauthenticatedHandler(handler: () => void) {
  onUnauthenticated = handler;
}

/** Awaits an API call, returning data or throwing ApiError (401 also triggers the sign-in redirect). */
export async function call<T>(
  request: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const result = await request;
  if (result.response.status === 401) onUnauthenticated?.();
  return unwrap(result);
}

/**
 * The signed-in user from `GET /me`. The server answers signed-out visitors with `{ anonymous: true }`; until the
 * UI supports browsing signed out, that is handled like a 401 (the sign-in redirect).
 */
export function signedInUser(me: Schemas['Me']): User {
  if (!('anonymous' in me)) return me;
  onUnauthenticated?.();
  throw new ApiError({
    type: 'urn:tracker:error:UNAUTHENTICATED',
    title: 'Unauthenticated',
    status: 401,
    code: 'UNAUTHENTICATED',
    detail: 'Sign in to continue',
  });
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Uploads a file to an issue (multipart). */
export async function uploadAttachment(issueKey: string, file: File): Promise<Attachment> {
  const form = new FormData();
  form.set('file', file, file.name || 'pasted-file');
  return call(
    api.POST('/issues/{issue}/attachments', {
      params: { path: { issue: issueKey } },
      body: {} as never,
      bodySerializer: () => form,
    }),
  );
}

/** Markdown for an uploaded file: an inline image for raster images, a link otherwise. */
export function attachmentMarkdown(attachment: Attachment): string {
  const name = attachment.filename.replace(/[[\]]/g, '');
  return attachment.contentType.startsWith('image/') && attachment.contentType !== 'image/svg+xml'
    ? `![${name}](${attachment.url})`
    : `[${name}](${attachment.url})`;
}
