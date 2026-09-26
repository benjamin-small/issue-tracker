import { z } from '@hono/zod-openapi';
import { ERROR_CODES, type ErrorCode, ProblemSchema } from '@tracker/schema';
import type { Context } from 'hono';
import { DomainError } from '@tracker/core';

/** OpenAPI response entries for the given error codes, grouped by status. */
export function errorResponses(...codes: ErrorCode[]) {
  const byStatus = new Map<number, ErrorCode[]>();
  for (const code of ['VALIDATION_FAILED', 'UNAUTHENTICATED', ...codes] as ErrorCode[]) {
    const status = ERROR_CODES[code].status;
    byStatus.set(status, [...new Set([...(byStatus.get(status) ?? []), code])]);
  }
  const out: Record<
    number,
    {
      description: string;
      content: { 'application/problem+json': { schema: typeof ProblemSchema } };
    }
  > = {};
  for (const [status, list] of byStatus) {
    out[status] = {
      description: `Problem details. Codes: ${list.join(', ')}.`,
      content: { 'application/problem+json': { schema: ProblemSchema } },
    };
  }
  return out;
}

export function json<T extends z.ZodType>(schema: T, description: string) {
  return { description, content: { 'application/json': { schema } } };
}

export function jsonBody<T extends z.ZodType>(schema: T, description?: string) {
  return {
    required: true,
    ...(description && { description }),
    content: { 'application/json': { schema } },
  };
}

export const noContent = { description: 'Done.' };

/** Path parameter accepting an id or a human reference. */
export function refParam(name: string, description: string, example: string) {
  return z.string().openapi({ param: { name, in: 'path', description }, example });
}

export const IfMatchHeader = z.object({
  'if-match': z.string().optional().openapi({
    description:
      'Expected issue version from a previous ETag (e.g. `"v3"`). Mismatch → 412 VERSION_MISMATCH.',
    example: '"v3"',
  }),
});

/** Parses an `If-Match: "v3"` / `3` header into a version number. */
export function expectedVersion(c: Context): number | undefined {
  const raw = c.req.header('if-match');
  if (!raw || raw === '*') return undefined;
  const match = /^(?:W\/)?"?v?(\d+)"?$/.exec(raw.trim());
  if (!match) throw new DomainError('VALIDATION_FAILED', 'If-Match must look like "v3"');
  return Number(match[1]);
}

export function setEtag(c: Context, version: number): void {
  c.header('ETag', `"v${version}"`);
}

export const LimitQuery = z.coerce
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .openapi({ description: 'Page size (1–200, default 50).' });

export const CursorQuery = z
  .string()
  .optional()
  .openapi({ description: 'Opaque cursor from a previous `nextCursor`.' });

export const BooleanQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => v === 'true');
