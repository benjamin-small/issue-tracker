import { ERROR_CODES, type ErrorCode, type FieldError } from '@poietic-tech/issues-schema';
import type { z } from 'zod';

/**
 * The one error type services throw for expected failures. Transports map `code` to HTTP status
 * (`ERROR_CODES[code].status`) and CLI exit codes (`ERROR_CODES[code].exit`). Anything else is a bug (INTERNAL).
 */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly errors: FieldError[] | undefined;

  constructor(code: ErrorCode, message: string, errors?: FieldError[]) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.errors = errors;
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }
}

export const notFound = (what: string, ref: string) =>
  new DomainError('NOT_FOUND', `${what} "${ref}" not found`);
export const conflict = (message: string) => new DomainError('CONFLICT', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new DomainError('FORBIDDEN', message);
export const invalidRelation = (message: string) => new DomainError('INVALID_RELATION', message);
export const validationError = (message: string, errors?: FieldError[]) =>
  new DomainError('VALIDATION_FAILED', message, errors);

export function zodIssuesToFieldErrors(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/** Parses service input with a Zod schema, throwing VALIDATION_FAILED with per-field errors. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors = zodIssuesToFieldErrors(result.error);
    throw validationError(errors.map((e) => `${e.path}: ${e.message}`).join('; '), errors);
  }
  return result.data;
}

/** Maps unique-constraint violations from either dialect to CONFLICT. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return (
    e?.code === '23505' ||
    e?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    e?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  );
}
