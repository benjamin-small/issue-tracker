import { z } from 'zod';

export const TimestampSchema = z.iso
  .datetime({ offset: false })
  .meta({ description: 'ISO-8601 UTC timestamp.', example: '2026-09-26T13:49:00.123Z' });

export const DateOnlySchema = z.iso
  .date()
  .meta({ description: 'Calendar date.', example: '2026-12-31' });

export const ColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/)
  .meta({ description: 'Hex color.', example: '#5e6ad2' });

export const MetadataSchema = z.record(z.string(), z.unknown()).meta({
  description:
    'Free-form JSON for integrations and agents (e.g. branch names, PR URLs, agent session ids). Keys should be namespaced.',
  example: { 'github.pr': 'https://github.com/acme/app/pull/12' },
});

/** Paginated list envelope: `{ data, nextCursor }`. */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z
      .string()
      .nullable()
      .meta({ description: 'Opaque cursor for the next page; null when this is the last page.' }),
  });
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

export const LimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(200)
  .default(50)
  .meta({ description: 'Page size (1–200).' });
