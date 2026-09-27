import { ApiError } from '@tracker/client';
import { ERROR_CODES, type ErrorCode } from '@tracker/schema';

/**
 * Documented exit codes (part of the CLI contract; see docs/cli.md).
 * API error codes map to these through ERROR_CODES[code].exit.
 */
export const EXIT_CODES = {
  0: 'Success',
  1: 'Internal or unexpected error',
  2: 'Usage or validation error (bad flags, invalid input, invalid relation)',
  3: 'Not found',
  4: 'Conflict (duplicate, version mismatch, idempotency)',
  5: 'Authentication or permission error',
  6: 'Unavailable (server unreachable, database not migrated)',
} as const;

/** An error with a stable code, rendered as problem JSON under --json. */
export class CliError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly errors: Array<{ path: string; message: string }> | undefined;

  constructor(code: ErrorCode, message: string, errors?: Array<{ path: string; message: string }>) {
    super(message);
    this.code = code;
    this.exitCode = ERROR_CODES[code].exit;
    this.errors = errors;
  }
}

export function usage(message: string): CliError {
  return new CliError('VALIDATION_FAILED', message);
}

/** Normalizes anything thrown during a command into a CliError. */
export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) return error;
  if (error instanceof ApiError)
    return new CliError(error.code, error.message, error.problem.errors);
  const e = error as { code?: string; cause?: { code?: string }; message?: string; name?: string };
  if (typeof e?.code === 'string' && e.code in ERROR_CODES)
    return new CliError(e.code as ErrorCode, e.message ?? String(error));
  const netCode = e?.cause?.code ?? e?.code;
  if (e?.name === 'TypeError' && /fetch failed/i.test(e.message ?? ''))
    return new CliError('UNAVAILABLE', `Cannot reach the server (${netCode ?? 'network error'})`);
  if (netCode && ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT'].includes(netCode))
    return new CliError('UNAVAILABLE', `Cannot reach the server (${netCode})`);
  return new CliError('INTERNAL', e?.message ?? String(error));
}
