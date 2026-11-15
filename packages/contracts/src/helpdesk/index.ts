import { z } from 'zod'

export * from './settings'

const ReferenceSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()
const StageSchema = z.object({
  id: z.number().int().positive(), name: z.string(), closed: z.boolean(),
}).strict()
const SlaRowSchema = z.object({
  id: z.number().int(), name: z.string(), state: z.string(), deadline: z.string().nullable(), hours: z.number(),
}).strict()
export const HelpdeskSlaSchema = z.object({
  state: z.enum(['none', 'on_track', 'due_soon', 'overdue']),
  deadline: z.string().nullable(),
  rows: z.array(SlaRowSchema),
}).strict()
export const HelpdeskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
const RequesterSchema = z.object({
  kind: z.enum(['customer', 'employee', 'guest']), id: z.number().int().positive().optional(), name: z.string(),
}).strict()
const AssigneeSchema = z.object({ id: z.number().int().positive(), name: z.string() }).strict()

export const HelpdeskTicketRowSchema = z.object({
  id: z.number().int().positive(),
  number: z.string(),
  subject: z.string(),
  team: ReferenceSchema.nullable(),
  stage: StageSchema,
  priority: HelpdeskPrioritySchema,
  assignee: AssigneeSchema.nullable(),
  requester: RequesterSchema,
  category: ReferenceSchema.nullable(),
  type: ReferenceSchema.nullable(),
  channel: ReferenceSchema.nullable(),
  tags: z.array(ReferenceSchema),
  sla: HelpdeskSlaSchema,
  created_at: z.string(),
  last_activity_at: z.string(),
}).strict()

export const HelpdeskAttachmentSchema = z.object({
  id: z.number().int().positive(), name: z.string(), mimetype: z.string().nullable(), size: z.number().int(),
  created_at: z.string(),
}).strict()

export const HelpdeskTicketSchema = HelpdeskTicketRowSchema.extend({
  description: z.string(),
  related: z.array(z.object({ id: z.number().int(), number: z.string(), subject: z.string() }).strict()),
  first_response: z.object({ at: z.string().nullable(), due: z.string().nullable() }).strict(),
  assigned_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  attachments: z.array(HelpdeskAttachmentSchema),
}).strict()

export const HelpdeskTicketPageSchema = z.object({
  items: z.array(HelpdeskTicketRowSchema),
  total: z.number().int().nonnegative(),
}).strict()

export const HelpdeskMessageSchema = z.object({
  id: z.number().int().positive(),
  body: z.string(),
  author: z.string(),
  author_id: z.number().int().positive().nullable(),
  internal: z.boolean(),
  created_at: z.string(),
}).strict()

export const HelpdeskMessagesSchema = z.object({
  items: z.array(HelpdeskMessageSchema),
  total: z.number().int().nonnegative().optional(),
}).strict()

export const HelpdeskAttachmentsSchema = z.object({
  items: z.array(HelpdeskAttachmentSchema),
  total: z.number().int().nonnegative().optional(),
}).strict()

export const HelpdeskReferenceSchema = z.object({
  teams: z.array(ReferenceSchema),
  stages: z.array(StageSchema),
  categories: z.array(ReferenceSchema),
  types: z.array(ReferenceSchema),
  channels: z.array(ReferenceSchema),
  tags: z.array(ReferenceSchema),
}).strict()

export const HelpdeskSummarySchema = z.object({
  open: z.number().int().nonnegative(),
  unassigned: z.number().int().nonnegative(),
  mine: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
}).strict()

/** The body of `POST /api/v1/helpdesk/tickets` and of the patch that changes one. */
export const HelpdeskTicketCreateSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  team_id: z.number().int().positive().optional(),
  category_id: z.number().int().positive().optional(),
  type_id: z.number().int().positive().optional(),
  channel_id: z.number().int().positive().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  priority: HelpdeskPrioritySchema.optional(),
  customer_id: z.number().int().positive().optional(),
  assignee_id: z.number().int().positive().nullable().optional(),
}).strict()

export const HelpdeskTicketPatchSchema = HelpdeskTicketCreateSchema.partial().extend({
  related_ids: z.array(z.number().int().positive()).optional(),
}).strict()

export type HelpdeskPriority = z.infer<typeof HelpdeskPrioritySchema>
export type HelpdeskTicketRow = z.infer<typeof HelpdeskTicketRowSchema>
export type HelpdeskTicket = z.infer<typeof HelpdeskTicketSchema>
export type HelpdeskTicketPage = z.infer<typeof HelpdeskTicketPageSchema>
export type HelpdeskTicketCreate = z.infer<typeof HelpdeskTicketCreateSchema>
export type HelpdeskTicketPatch = z.infer<typeof HelpdeskTicketPatchSchema>
export type HelpdeskMessage = z.infer<typeof HelpdeskMessageSchema>
export type HelpdeskAttachment = z.infer<typeof HelpdeskAttachmentSchema>
export type HelpdeskReference = z.infer<typeof HelpdeskReferenceSchema>
export type HelpdeskSummary = z.infer<typeof HelpdeskSummarySchema>
