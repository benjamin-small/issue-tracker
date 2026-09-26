import { z } from 'zod';
import { nullableRef, TimestampSchema } from './common.ts';
import {
  CommentSchema,
  IssueRefSchema,
  IssueSchema,
  LabelSchema,
  ProjectSchema,
  StatusSchema,
  UserSchema,
  UserSummarySchema,
} from './entities.ts';

/**
 * Event types recorded in the append-only event log. Each is delivered via activity history,
 * `GET /events`, SSE and webhooks with the payload schema in {@link EVENT_DATA_SCHEMAS}.
 */
export const EVENT_TYPES = [
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'issue.restored',
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'link.created',
  'link.deleted',
  'project.created',
  'project.updated',
  'status.created',
  'status.updated',
  'status.deleted',
  'label.created',
  'label.updated',
  'label.deleted',
  'user.created',
  'user.updated',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EventTypeSchema = z.enum(EVENT_TYPES);

export const FieldChangeSchema = z.object({ from: z.unknown(), to: z.unknown() });
export const ChangesSchema = z.record(z.string(), FieldChangeSchema).meta({
  description: 'Changed fields with previous and new values.',
  example: { priority: { from: 3, to: 1 } },
});
export type Changes = z.infer<typeof ChangesSchema>;

const base = {
  requestId: z.string().optional().meta({ description: 'Request that caused the event.' }),
};

export const IssueEventDataSchema = z
  .object({ ...base, issue: IssueSchema, changes: ChangesSchema.optional() })
  .meta({ id: 'IssueEventData' });
export const CommentEventDataSchema = z
  .object({ ...base, comment: CommentSchema, issue: IssueRefSchema })
  .meta({ id: 'CommentEventData' });
export const LinkEventDataSchema = z
  .object({
    ...base,
    link: z.object({
      id: z.string(),
      type: z.string(),
      source: IssueRefSchema,
      target: IssueRefSchema,
    }),
  })
  .meta({ id: 'LinkEventData' });
export const ProjectEventDataSchema = z
  .object({ ...base, project: ProjectSchema, changes: ChangesSchema.optional() })
  .meta({ id: 'ProjectEventData' });
export const StatusEventDataSchema = z
  .object({ ...base, status: StatusSchema, changes: ChangesSchema.optional() })
  .meta({ id: 'StatusEventData' });
export const LabelEventDataSchema = z
  .object({ ...base, label: LabelSchema, changes: ChangesSchema.optional() })
  .meta({ id: 'LabelEventData' });
export const UserEventDataSchema = z
  .object({ ...base, user: UserSchema, changes: ChangesSchema.optional() })
  .meta({ id: 'UserEventData' });

export const EVENT_DATA_SCHEMAS = {
  'issue.created': IssueEventDataSchema,
  'issue.updated': IssueEventDataSchema,
  'issue.deleted': IssueEventDataSchema,
  'issue.restored': IssueEventDataSchema,
  'comment.created': CommentEventDataSchema,
  'comment.updated': CommentEventDataSchema,
  'comment.deleted': CommentEventDataSchema,
  'link.created': LinkEventDataSchema,
  'link.deleted': LinkEventDataSchema,
  'project.created': ProjectEventDataSchema,
  'project.updated': ProjectEventDataSchema,
  'status.created': StatusEventDataSchema,
  'status.updated': StatusEventDataSchema,
  'status.deleted': StatusEventDataSchema,
  'label.created': LabelEventDataSchema,
  'label.updated': LabelEventDataSchema,
  'label.deleted': LabelEventDataSchema,
  'user.created': UserEventDataSchema,
  'user.updated': UserEventDataSchema,
} as const satisfies Record<EventType, z.ZodType>;

export const EventSchema = z
  .object({
    seq: z.number().int().meta({
      description: 'Strictly increasing in commit order (may skip values). Use as a cursor.',
    }),
    id: z.string(),
    type: EventTypeSchema,
    actorId: z.string().nullable(),
    actor: nullableRef(UserSummarySchema),
    projectId: z.string().nullable(),
    issueId: z.string().nullable(),
    data: z
      .record(z.string(), z.unknown())
      .meta({ description: 'Payload; shape depends on `type`.' }),
    createdAt: TimestampSchema,
  })
  .meta({ id: 'Event' });
export type TrackerEvent = z.infer<typeof EventSchema>;
