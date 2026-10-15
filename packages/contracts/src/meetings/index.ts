import { z } from 'zod'

export const MeetingPersonSchema = z.object({
  id: z.number().int(),
  name: z.string(),
}).strip()

export const MeetingListItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  reference: z.string(),
  meeting_date: z.string().nullable(),
  start_datetime: z.string().nullable(),
  end_datetime: z.string().nullable(),
  state: z.enum(['draft', 'confirmed', 'done', 'cancelled']),
  organizer: MeetingPersonSchema.nullable(),
  open_resolution_count: z.number().int(),
  series_id: z.number().int().nullable(),
  project_id: z.number().int().nullable(),
}).strip()

export const MeetingListSchema = z.object({
  items: z.array(MeetingListItemSchema),
  total: z.number().int(),
}).strip()

export const MeetingResolutionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  deadline: z.string().nullable(),
  priority: z.enum(['0', '1', '2', '3']),
  state: z.enum(['open', 'in_progress', 'done', 'cancelled']),
  responsible: MeetingPersonSchema.nullable(),
  task_id: z.number().int().nullable(),
  result: z.string(),
  can_update_execution: z.boolean(),
  can_edit_decision: z.boolean(),
  execution_state: z.enum(['open', 'in_progress', 'done', 'cancelled']).optional(),
  task_linked: z.boolean().optional(),
  allowed_actions: z.array(z.enum(['start', 'complete', 'cancel', 'reopen', 'edit_result'])).optional(),
  execution_period: z.string().optional(),
  project: MeetingPersonSchema.nullable().optional(),
}).strip()

export const MeetingPreviousResolutionSchema = MeetingResolutionSchema.extend({
  meeting_id: z.number().int(),
  meeting_name: z.string(),
}).strip()

export const MeetingSnapshotResolutionSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  deadline: z.string().nullable(),
  priority: z.enum(['0', '1', '2', '3']),
  state: z.enum(['open', 'in_progress', 'done', 'cancelled']),
  responsible: MeetingPersonSchema.nullable(),
  result: z.string(),
  meeting_name: z.string().optional(),
  execution_period: z.string().optional(),
  project: MeetingPersonSchema.nullable().optional(),
}).strip()

export const MeetingMinutesTopicSchema = z.object({
  key: z.string().trim().min(1).max(200),
  title: z.string().max(500),
  discussion: z.string().max(50000),
  project_id: z.number().int().positive().nullable(),
  resolution_ids: z.array(z.number().int().positive()).max(200),
}).strict()

export const MeetingMinutesFormSchema = z.object({
  opening: z.string().max(50000),
  closing: z.string().max(50000),
  chairperson: z.string().max(500),
  approver_name: z.string().max(500),
  approver_title: z.string().max(500),
  topics: z.array(MeetingMinutesTopicSchema).max(100),
}).strict()

export const MeetingMinutesSnapshotSchema = z.object({
  captured_at: z.string().nullish(),
  name: z.string(),
  meeting_date: z.string().nullable(),
  start_datetime: z.string().nullable(),
  end_datetime: z.string().nullable(),
  location: z.string(),
  organizer: MeetingPersonSchema.nullable(),
  secretary: MeetingPersonSchema.nullable(),
  attendees: z.array(MeetingPersonSchema),
  agenda: z.string(),
  minutes: z.string(),
  resolutions: z.array(MeetingSnapshotResolutionSchema),
  minutes_form: MeetingMinutesFormSchema.optional(),
}).strip()

export const MeetingDetailSchema = MeetingListItemSchema.extend({
  agenda: z.string(),
  minutes: z.string(),
  location: z.string(),
  meeting_url: z.string(),
  can_edit: z.boolean(),
  can_manage: z.boolean(),
  secretary: MeetingPersonSchema.nullable(),
  attendees: z.array(MeetingPersonSchema),
  resolutions: z.array(MeetingResolutionSchema),
  series: MeetingPersonSchema.nullable(),
  project: MeetingPersonSchema.nullable(),
  previous_resolutions: z.array(MeetingPreviousResolutionSchema),
  minutes_snapshot: MeetingMinutesSnapshotSchema.nullable().optional(),
  minutes_form: MeetingMinutesFormSchema.optional(),
}).strip()

export const MeetingCreateSchema = z.object({
  name: z.string().trim().min(1),
  meeting_date: z.string().optional(),
  location: z.string().optional(),
  start_datetime: z.string().optional(),
  end_datetime: z.string().optional(),
  meeting_url: z.string().optional(),
  secretary_id: z.number().int().nullable().optional(),
  attendee_ids: z.array(z.number().int()).optional(),
  agenda: z.string().optional(),
  series_id: z.number().int().optional(),
  project_id: z.number().int().optional(),
  minutes_form: MeetingMinutesFormSchema.optional(),
}).strict()

export const MeetingPatchSchema = MeetingCreateSchema.partial().extend({
  agenda: z.string().optional(),
  minutes: z.string().optional(),
  start_datetime: z.string().nullable().optional(),
  end_datetime: z.string().nullable().optional(),
  secretary_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  minutes_form: MeetingMinutesFormSchema.optional(),
  scope: z.enum(['this', 'this_and_following']).optional(),
}).strict()

export const MeetingResolutionCreateSchema = z.object({
  name: z.string().trim().min(1),
  responsible_id: z.number().int(),
  deadline: z.string().min(1).nullable().optional(),
  priority: z.enum(['0', '1', '2', '3']).optional(),
  execution_period: z.string().max(500).optional(),
  project_id: z.number().int().positive().nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.deadline && !value.execution_period?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['deadline'], message: 'A deadline or execution period is required.' })
  }
})

export const MeetingResolutionPatchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  responsible_id: z.number().int().optional(),
  deadline: z.string().min(1).nullable().optional(),
  priority: z.enum(['0', '1', '2', '3']).optional(),
  execution_period: z.string().max(500).optional(),
  project_id: z.number().int().positive().nullable().optional(),
  result: z.string().optional(),
}).strict()

export const MeetingEventSchema = z.object({
  id: z.number().int(),
  meeting_id: z.number().int(),
  meeting_name: z.string(),
  occurred_at: z.string(),
  actor: MeetingPersonSchema.nullable(),
  kind: z.string(),
  summary: z.string(),
}).strip()

export const MeetingEventListSchema = z.object({ items: z.array(MeetingEventSchema), total: z.number().int() }).strip()

export const MeetingVersionSchema = z.object({
  id: z.number().int(),
  number: z.number().int(),
  captured_at: z.string(),
  actor: MeetingPersonSchema.nullable(),
  snapshot: MeetingMinutesSnapshotSchema.nullable(),
}).strip()

export const MeetingVersionListSchema = z.object({ items: z.array(MeetingVersionSchema), total: z.number().int() }).strip()

export const MeetingSeriesResolutionListSchema = z.object({
  items: z.array(MeetingPreviousResolutionSchema),
  total: z.number().int(),
}).strip()

export const MeetingSeriesListItemSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']),
  until_date: z.string().nullable(),
  until_count: z.number().int().nullable(),
  organizer: MeetingPersonSchema.nullable(),
  project: MeetingPersonSchema.nullable(),
  open_resolution_count: z.number().int(),
  overdue_resolution_count: z.number().int(),
}).strip()

export const MeetingSeriesListSchema = z.object({
  items: z.array(MeetingSeriesListItemSchema),
  total: z.number().int(),
}).strip()

export const MeetingSeriesDetailSchema = MeetingSeriesListItemSchema.extend({
  location: z.string(),
  meeting_url: z.string(),
  secretary: MeetingPersonSchema.nullable(),
  attendees: z.array(MeetingPersonSchema),
  meetings: z.array(MeetingListItemSchema),
  can_edit: z.boolean().optional(),
}).strip()

export const MeetingSeriesCreateSchema = z.object({
  name: z.string().trim().min(1),
  project_id: z.number().int().optional(),
  secretary_id: z.number().int().optional(),
  attendee_ids: z.array(z.number().int()).optional(),
  recurrence: z.enum(['none', 'weekly', 'biweekly', 'monthly']).optional(),
  until_date: z.iso.date().optional(),
  until_count: z.number().int().min(1).max(60).optional(),
  location: z.string().optional(),
  meeting_url: z.string().optional(),
  start_datetime: z.iso.datetime({ offset: true }).optional(),
  end_datetime: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.recurrence || value.recurrence === 'none') return
  if (Boolean(value.until_date) === (value.until_count !== undefined)) {
    ctx.addIssue({ code: 'custom', path: ['until_count'], message: 'Choose an end date or an occurrence count.' })
  }
  for (const field of ['start_datetime', 'end_datetime'] as const) {
    if (!value[field]) ctx.addIssue({ code: 'custom', path: [field], message: 'A recurring series requires a start and end.' })
  }
  if (value.start_datetime && value.end_datetime && Date.parse(value.end_datetime) <= Date.parse(value.start_datetime)) {
    ctx.addIssue({ code: 'custom', path: ['end_datetime'], message: 'The end must be after the start.' })
  }
  if (value.until_date && value.start_datetime && Number.isFinite(Date.parse(value.start_datetime))) {
    const firstDate = new Date(value.start_datetime).toISOString().slice(0, 10)
    if (value.until_date < firstDate) {
      ctx.addIssue({ code: 'custom', path: ['until_date'], message: 'The end date cannot precede the first meeting.' })
    }
  }
})

export type MeetingListItem = z.infer<typeof MeetingListItemSchema>
export type MeetingList = z.infer<typeof MeetingListSchema>
export type MeetingDetail = z.infer<typeof MeetingDetailSchema>
export type MeetingMinutesSnapshot = z.infer<typeof MeetingMinutesSnapshotSchema>
export type MeetingMinutesForm = z.infer<typeof MeetingMinutesFormSchema>
export type MeetingEvent = z.infer<typeof MeetingEventSchema>
export type MeetingVersion = z.infer<typeof MeetingVersionSchema>
export type MeetingCreate = z.infer<typeof MeetingCreateSchema>
export type MeetingPatch = z.infer<typeof MeetingPatchSchema>
export type MeetingResolutionCreate = z.infer<typeof MeetingResolutionCreateSchema>
export type MeetingResolutionPatch = z.infer<typeof MeetingResolutionPatchSchema>
export type MeetingSeriesListItem = z.infer<typeof MeetingSeriesListItemSchema>
export type MeetingSeriesDetail = z.infer<typeof MeetingSeriesDetailSchema>
export type MeetingSeriesCreate = z.infer<typeof MeetingSeriesCreateSchema>
