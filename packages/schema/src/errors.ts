import { z } from 'zod';

/**
 * Closed catalog of machine-readable error codes. Part of the public contract: API problem responses
 * carry one in `code`, and the CLI maps each to an exit code. Add codes; never repurpose them.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, title: 'Validation failed', exit: 2 },
  UNAUTHENTICATED: { status: 401, title: 'Authentication required', exit: 5 },
  FORBIDDEN: { status: 403, title: 'Forbidden', exit: 5 },
  PENDING_APPROVAL: { status: 403, title: 'Awaiting approval', exit: 5 },
  NOT_FOUND: { status: 404, title: 'Not found', exit: 3 },
  CONFLICT: { status: 409, title: 'Conflict', exit: 4 },
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    title: 'Request with this idempotency key is in progress',
    exit: 4,
  },
  VERSION_MISMATCH: { status: 412, title: 'Version mismatch', exit: 4 },
  PAYLOAD_TOO_LARGE: { status: 413, title: 'Payload too large', exit: 2 },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, title: 'Unsupported media type', exit: 2 },
  INVALID_RELATION: { status: 422, title: 'Invalid relation', exit: 2 },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    title: 'Idempotency key reused with a different request',
    exit: 4,
  },
  RATE_LIMITED: { status: 429, title: 'Too many requests', exit: 6 },
  INTERNAL: { status: 500, title: 'Internal error', exit: 1 },
  UNAVAILABLE: { status: 503, title: 'Service unavailable', exit: 6 },
} as const satisfies Record<string, { status: number; title: string; exit: number }>;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ErrorCodeSchema = z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]);

export const FieldErrorSchema = z.object({
  path: z
    .string()
    .meta({ description: 'Dotted path of the offending input field.', example: 'title' }),
  message: z.string(),
});
export type FieldError = z.infer<typeof FieldErrorSchema>;

/** RFC 9457 problem details, as returned by every error response (`application/problem+json`). */
export const ProblemSchema = z
  .object({
    type: z.string().meta({ example: 'urn:tracker:error:NOT_FOUND' }),
    title: z.string(),
    status: z.number().int(),
    code: ErrorCodeSchema,
    detail: z.string().optional(),
    errors: z.array(FieldErrorSchema).optional(),
    requestId: z.string().optional(),
  })
  .meta({
    id: 'Problem',
    description: 'RFC 9457 problem details with a stable machine-readable `code`.',
  });
export type Problem = z.infer<typeof ProblemSchema>;
