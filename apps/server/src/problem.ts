import { DomainError, zodIssuesToFieldErrors } from '@tracker/core';
import { ERROR_CODES, type ErrorCode, type FieldError, type Problem } from '@tracker/schema';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ZodError } from 'zod';

export function problemBody(
  code: ErrorCode,
  detail?: string,
  errors?: FieldError[],
  requestId?: string,
): Problem {
  const meta = ERROR_CODES[code];
  return {
    type: `urn:tracker:error:${code}`,
    title: meta.title,
    status: meta.status,
    code,
    ...(detail !== undefined && { detail }),
    ...(errors && errors.length > 0 && { errors }),
    ...(requestId && { requestId }),
  };
}

/** Sends an RFC 9457 problem response. */
export function problem(
  c: Context,
  code: ErrorCode,
  detail?: string,
  errors?: FieldError[],
): Response {
  const body = problemBody(code, detail, errors, c.get('requestId') as string | undefined);
  return new Response(JSON.stringify(body), {
    status: body.status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

export function problemFromError(c: Context, error: unknown): Response {
  if (error instanceof DomainError) return problem(c, error.code, error.message, error.errors);
  if (isZodError(error)) {
    const errors = zodIssuesToFieldErrors(error);
    return problem(
      c,
      'VALIDATION_FAILED',
      errors.map((e) => `${e.path}: ${e.message}`).join('; '),
      errors,
    );
  }
  if (error instanceof HTTPException) {
    const byStatus: Record<number, ErrorCode> = {
      400: 'VALIDATION_FAILED',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      413: 'PAYLOAD_TOO_LARGE',
      415: 'UNSUPPORTED_MEDIA_TYPE',
    };
    const code = byStatus[error.status];
    if (code) return problem(c, code, error.message);
  }
  const status = (error as { status?: number }).status;
  if (status === 413) return problem(c, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  if (error instanceof SyntaxError) return problem(c, 'VALIDATION_FAILED', 'Malformed JSON body');
  console.error(`[${c.get('requestId') ?? '-'}] unhandled error`, error);
  return problem(c, 'INTERNAL', 'An unexpected error occurred');
}

function isZodError(error: unknown): error is ZodError {
  return (
    (error as { name?: string })?.name === 'ZodError' && Array.isArray((error as ZodError).issues)
  );
}
