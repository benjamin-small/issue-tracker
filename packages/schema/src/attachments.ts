import { z } from 'zod';
import { TimestampSchema } from './common.ts';
import { UserSummarySchema } from './entities.ts';

export const AttachmentSchema = z
  .object({
    id: z.string(),
    issueId: z.string(),
    commentId: z.string().nullable(),
    uploader: UserSummarySchema,
    filename: z.string().meta({ example: 'screenshot.png' }),
    contentType: z.string().meta({ description: 'Detected media type.', example: 'image/png' }),
    size: z.number().int().meta({ description: 'Bytes.' }),
    sha256: z.string(),
    url: z.string().meta({
      description:
        'Download URL (relative to the server). Images are served inline; other files as downloads.',
    }),
    createdAt: TimestampSchema,
    deletedAt: TimestampSchema.nullable(),
  })
  .meta({ id: 'Attachment' });
export type Attachment = z.infer<typeof AttachmentSchema>;
