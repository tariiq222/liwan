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
  portal_link: z.string().nullable(),
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

// ---------------------------------------------------------------- settings resources

export const HelpdeskResourceSchema = z.object({
  id: z.number().int().positive(), name: z.string(), active: z.boolean(), sequence: z.number().int(),
}).strict()

export const HelpdeskTeamResourceSchema = HelpdeskResourceSchema.extend({
  member_ids: z.array(z.object({ id: z.number().int().positive(), name: z.string() }).strict()),
  leader_id: z.number().int().positive().nullable(),
  calendar_id: z.number().int().positive().nullable(),
}).strict()

export const HelpdeskStageResourceSchema = HelpdeskResourceSchema.extend({
  closed: z.boolean(), unattended: z.boolean(), fold: z.boolean(),
  team_ids: z.array(z.number().int().positive()), shared: z.boolean(),
}).strict()

export const HelpdeskCategoryResourceSchema = HelpdeskResourceSchema.extend({
  parent_id: z.number().int().positive().nullable(),
}).strict()

export const HelpdeskResourcesSchema = z.object({
  teams: z.array(HelpdeskTeamResourceSchema),
  stages: z.array(HelpdeskStageResourceSchema),
  categories: z.array(HelpdeskCategoryResourceSchema),
  tags: z.array(HelpdeskResourceSchema),
  channels: z.array(HelpdeskResourceSchema),
  types: z.array(HelpdeskResourceSchema),
}).strict()

export const HelpdeskTeamSaveSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  member_ids: z.array(z.number().int().positive()).optional(),
  leader_id: z.number().int().positive().nullable().optional(),
  calendar_id: z.number().int().positive().nullable().optional(),
  sequence: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

export const HelpdeskStageSaveSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  sequence: z.number().int().min(0).max(9999).optional(),
  closed: z.boolean().optional(),
  unattended: z.boolean().optional(),
  fold: z.boolean().optional(),
  team_ids: z.array(z.number().int().positive()).optional(),
  active: z.boolean().optional(),
}).strict()

export const HelpdeskCategorySaveSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  parent_id: z.number().int().positive().nullable().optional(),
  sequence: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

export const HelpdeskValueSaveSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  sequence: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
}).strict()

export type HelpdeskResource = z.infer<typeof HelpdeskResourceSchema>
export type HelpdeskTeamResource = z.infer<typeof HelpdeskTeamResourceSchema>
export type HelpdeskStageResource = z.infer<typeof HelpdeskStageResourceSchema>
export type HelpdeskCategoryResource = z.infer<typeof HelpdeskCategoryResourceSchema>
export type HelpdeskResources = z.infer<typeof HelpdeskResourcesSchema>
export type HelpdeskTeamSave = z.infer<typeof HelpdeskTeamSaveSchema>
export type HelpdeskStageSave = z.infer<typeof HelpdeskStageSaveSchema>
export type HelpdeskCategorySave = z.infer<typeof HelpdeskCategorySaveSchema>
export type HelpdeskValueSave = z.infer<typeof HelpdeskValueSaveSchema>

// ---------------------------------------------------------------- service levels

export const HelpdeskSlaPolicySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  active: z.boolean(),
  days: z.number().int().nonnegative(),
  hours: z.number().int().nonnegative(),
  stage_id: z.number().int().positive().nullable(),
  team_ids: z.array(z.number().int().positive()),
  category_ids: z.array(z.number().int().positive()),
  tag_ids: z.array(z.number().int().positive()),
  ignore_stage_ids: z.array(z.number().int().positive()),
  ticket_count: z.number().int().nonnegative(),
}).strict()

export const HelpdeskSlaListSchema = z.object({
  items: z.array(HelpdeskSlaPolicySchema),
  targets: z.array(z.object({ code: z.string(), label_key: z.string() }).strict()),
}).strict()

export const HelpdeskSlaSaveSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  days: z.number().int().min(0).max(365),
  hours: z.number().int().min(0).max(23),
  stage_id: z.number().int().positive(),
  team_ids: z.array(z.number().int().positive()).optional(),
  category_ids: z.array(z.number().int().positive()).optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
  ignore_stage_ids: z.array(z.number().int().positive()).optional(),
  active: z.boolean().optional(),
}).strict()

export type HelpdeskSlaPolicy = z.infer<typeof HelpdeskSlaPolicySchema>
export type HelpdeskSlaList = z.infer<typeof HelpdeskSlaListSchema>
export type HelpdeskSlaSave = z.infer<typeof HelpdeskSlaSaveSchema>

// ---------------------------------------------------------------- reports

export const HelpdeskReportSchema = z.object({
  period: z.number().int().positive(),
  periods: z.array(z.object({ value: z.string(), label: z.string() }).strict()),
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  kpis: z.object({
    first_response_hours: z.number().nullable(),
    first_response_target: z.number().nullable(),
    first_response_answered: z.number().int().nonnegative(),
    resolution_hours: z.number().nullable(),
    resolution_target: z.number().nullable(),
    sla_met: z.number().int().nonnegative(),
    sla_late: z.number().int().nonnegative(),
    sla_compliance_percent: z.number().nullable(),
    open_percent: z.number().nullable(),
  }).strict(),
  agents: z.array(z.object({
    name: z.string(),
    open: z.number().int().nonnegative(),
    closed: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
    first_response_hours: z.number().nullable(),
  }).strict()),
  stages: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() }).strict()),
}).strict()

export type HelpdeskReport = z.infer<typeof HelpdeskReportSchema>

// ---------------------------------------------------------------- the customer's page

export const HelpdeskPortalMessageSchema = z.object({
  id: z.number().int().positive(), body: z.string(), author: z.string(), created_at: z.string(),
}).strict()

export const HelpdeskPortalTicketSchema = z.object({
  number: z.string(),
  subject: z.string(),
  description: z.string(),
  stage: z.object({ name: z.string(), closed: z.boolean() }).strict(),
  priority: z.string(),
  created_at: z.string(),
  closed_at: z.string().nullable(),
  company: z.object({ name: z.string(), logo: z.boolean() }).strict(),
  messages: z.array(HelpdeskPortalMessageSchema),
  actions: z.object({ reply: z.boolean(), close: z.boolean(), reopen: z.boolean() }).strict(),
}).strict()

export type HelpdeskPortalTicket = z.infer<typeof HelpdeskPortalTicketSchema>
