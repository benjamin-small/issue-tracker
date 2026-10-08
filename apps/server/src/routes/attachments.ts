import { createRoute, z } from '@hono/zod-openapi';
import {
  type BlobStore,
  contentDisposition,
  DEFAULT_MAX_UPLOAD_BYTES,
  DomainError,
  deleteAttachment,
  getAttachment,
  INLINE_SAFE_TYPES,
  listAttachments,
  uploadAttachment,
} from '@poietic-tech/issues-core';
import { AttachmentSchema } from '@poietic-tech/issues-schema';
import { bodyLimit } from 'hono/body-limit';
import type { ResolvedDeps, TrackerApp } from '../env.ts';
import { problem } from '../problem.ts';
import { errorResponses, json, refParam } from './common.ts';

const tags = ['Attachments'];
const issueParam = z.object({
  issue: refParam('issue', 'Issue key (e.g. `ENG-42`) or id.', 'ENG-42'),
});
const idParam = z.object({
  id: refParam('id', 'Attachment id.', 'att_01h455vb4pex5vsknk084sn02q'),
});

/**
 * Attachments: multipart upload, metadata, and hardened downloads. Only raster images are served inline;
 * everything else (including SVG, HTML and PDF) downloads as a file, always with `nosniff` and a sandboxing CSP.
 */
export function registerAttachmentRoutes(
  app: TrackerApp,
  deps: ResolvedDeps & { blobStore?: BlobStore; maxUploadBytes?: number },
) {
  const maxBytes = deps.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const blobs = () => {
    if (!deps.blobStore)
      throw new DomainError('UNAVAILABLE', 'File storage is not configured on this server');
    return deps.blobStore;
  };

  app.openAPIRegistry.registerPath({
    method: 'post',
    path: '/issues/{issue}/attachments',
    tags,
    summary: 'Upload a file to an issue',
    description: `multipart/form-data with a \`file\` part (max ${Math.round(maxBytes / 1024 / 1024)} MB) and optional \`commentId\`. The media type is detected from the content.`,
    request: {
      params: issueParam,
      body: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: z.object({
              file: z.string().openapi({ type: 'string', format: 'binary' }),
              commentId: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      201: json(AttachmentSchema, 'Uploaded'),
      ...errorResponses('NOT_FOUND', 'PAYLOAD_TOO_LARGE', 'CONFLICT'),
    },
  });
  app.post(
    '/issues/:issue/attachments',
    bodyLimit({
      maxSize: maxBytes + 64 * 1024,
      onError: (c) => problem(c, 'PAYLOAD_TOO_LARGE', 'File too large'),
    }),
    async (c) => {
      const store = blobs();
      const contentType = c.req.header('content-type') ?? '';
      if (!contentType.startsWith('multipart/form-data'))
        return problem(
          c,
          'UNSUPPORTED_MEDIA_TYPE',
          'Upload with multipart/form-data and a "file" part',
        );
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File))
        return problem(c, 'VALIDATION_FAILED', 'Missing "file" part', [
          { path: 'file', message: 'Required' },
        ]);
      const attachment = await uploadAttachment(
        c.get('ctx'),
        store,
        c.req.param('issue'),
        {
          filename: file.name,
          data: new Uint8Array(await file.arrayBuffer()),
          commentId:
            typeof body.commentId === 'string' && body.commentId ? body.commentId : undefined,
        },
        { maxBytes },
      );
      return c.json(attachment, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/issues/{issue}/attachments',
      tags,
      summary: "List an issue's attachments",
      request: { params: issueParam },
      responses: {
        200: json(z.object({ data: z.array(AttachmentSchema) }), 'Attachments'),
        ...errorResponses('NOT_FOUND'),
      },
    }),
    async (c) =>
      c.json({ data: await listAttachments(c.get('ctx'), c.req.valid('param').issue) }, 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/attachments/{id}',
      tags,
      summary: 'Attachment metadata',
      request: { params: idParam },
      responses: { 200: json(AttachmentSchema, 'Attachment'), ...errorResponses('NOT_FOUND') },
    }),
    async (c) => {
      const { storageKey: _key, ...attachment } = await getAttachment(
        c.get('ctx'),
        c.req.valid('param').id,
      );
      return c.json(attachment, 200);
    },
  );

  app.openAPIRegistry.registerPath({
    method: 'get',
    path: '/attachments/{id}/content',
    tags,
    summary: 'Download the file',
    description:
      'Raster images are served inline; other types as downloads (`?download=1` forces a download). With S3 storage ' +
      'this redirects (302) to a short-lived presigned URL.',
    request: { params: idParam, query: z.object({ download: z.enum(['1', 'true']).optional() }) },
    responses: {
      200: {
        description: 'File content',
        content: {
          'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
        },
      },
      302: { description: 'Redirect to object storage' },
      ...errorResponses('NOT_FOUND'),
    },
  });
  app.get('/attachments/:id/content', async (c) => {
    const store = blobs();
    const attachment = await getAttachment(c.get('ctx'), c.req.param('id'));
    const forceDownload = c.req.query('download') !== undefined;
    const inline = INLINE_SAFE_TYPES.has(attachment.contentType) && !forceDownload;
    const disposition = contentDisposition(inline ? 'inline' : 'attachment', attachment.filename);
    const contentType =
      attachment.contentType.startsWith('text/') || attachment.contentType === 'application/json'
        ? `${attachment.contentType}; charset=utf-8`
        : attachment.contentType;
    if (store.presignedGetUrl) {
      const url = await store.presignedGetUrl(attachment.storageKey, { contentType, disposition });
      c.header('Cache-Control', 'private, no-store');
      return c.redirect(url, 302);
    }
    const data = await store.get(attachment.storageKey);
    if (!data) return problem(c, 'NOT_FOUND', 'File content is missing');
    return c.body(data as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': contentType,
      'Content-Length': String(data.byteLength),
      'Content-Disposition': disposition,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'private, max-age=86400',
    });
  });

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/attachments/{id}',
      tags,
      summary: 'Delete an attachment (uploader or admin)',
      request: { params: idParam },
      responses: {
        200: json(AttachmentSchema, 'Deleted'),
        ...errorResponses('NOT_FOUND', 'FORBIDDEN'),
      },
    }),
    async (c) =>
      c.json(await deleteAttachment(c.get('ctx'), blobs(), c.req.valid('param').id), 200),
  );
}
