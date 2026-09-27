import { z } from 'zod';
import { ColorSchema, TimestampSchema } from './common.ts';

export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'boolean',
  'select',
  'multi_select',
  'user',
  'url',
] as const;
export const CustomFieldTypeSchema = z.enum(CUSTOM_FIELD_TYPES).meta({
  description:
    'text/url: string · number · date: YYYY-MM-DD · boolean · select: one option value · multi_select: option values · user: user id',
});
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const CustomFieldOptionSchema = z
  .object({
    id: z.string(),
    value: z
      .string()
      .meta({ description: 'Stable value used in the API, filters and the CLI.', example: 'high' }),
    label: z.string().meta({ example: 'High' }),
    color: ColorSchema,
    position: z.number().int(),
    archivedAt: TimestampSchema.nullable().meta({
      description: 'Archived options can no longer be chosen.',
    }),
  })
  .meta({ id: 'CustomFieldOption' });
export type CustomFieldOption = z.infer<typeof CustomFieldOptionSchema>;

export const CustomFieldSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    key: z.string().meta({
      description: 'Immutable key: `issue.customFields[key]`, filters use `cf:<key>`.',
      example: 'severity',
    }),
    name: z.string().meta({ example: 'Severity' }),
    description: z.string(),
    type: CustomFieldTypeSchema,
    config: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Display hints, e.g. `{ "unit": "pts" }`.' }),
    position: z.number().int(),
    options: z
      .array(CustomFieldOptionSchema)
      .meta({ description: 'Choices for select and multi_select fields.' }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    archivedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'CustomField' });
export type CustomField = z.infer<typeof CustomFieldSchema>;

const OptionValueSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^,]+$/, 'option values cannot contain commas (they separate values in query strings)');

export const CreateFieldOptionInputSchema = z
  .object({
    value: OptionValueSchema,
    label: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .meta({ description: 'Defaults to the value.' }),
    color: ColorSchema.optional(),
  })
  .meta({ id: 'CreateFieldOptionInput' });
export type CreateFieldOptionInput = z.input<typeof CreateFieldOptionInputSchema>;

export const UpdateFieldOptionInputSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    color: ColorSchema,
    position: z.number().int().min(0),
    archived: z.boolean(),
  })
  .partial()
  .meta({ id: 'UpdateFieldOptionInput' });
export type UpdateFieldOptionInput = z.input<typeof UpdateFieldOptionInputSchema>;

export const CreateCustomFieldInputSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]{0,39}$/,
        'key must be lowercase letters, digits and _, starting with a letter',
      )
      .meta({ example: 'severity' }),
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500).default(''),
    type: CustomFieldTypeSchema,
    config: z.record(z.string(), z.unknown()).default({}),
    options: z
      .array(CreateFieldOptionInputSchema)
      .max(100)
      .default([])
      .meta({ description: 'For select and multi_select.' }),
  })
  .meta({ id: 'CreateCustomFieldInput' });
export type CreateCustomFieldInput = z.input<typeof CreateCustomFieldInputSchema>;

export const UpdateCustomFieldInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().max(500),
    config: z.record(z.string(), z.unknown()),
    position: z.number().int().min(0),
    archived: z
      .boolean()
      .meta({ description: 'Archived fields are hidden and their values ignored (not deleted).' }),
  })
  .partial()
  .meta({ id: 'UpdateCustomFieldInput' });
export type UpdateCustomFieldInput = z.input<typeof UpdateCustomFieldInputSchema>;
