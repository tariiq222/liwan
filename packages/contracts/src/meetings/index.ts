import { z } from 'zod'

export const MeetingPersonSchema = z.object({
  id: z.number().int(),
  name: z.string(),
}).strict()

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
}).strict()

export const MeetingListSchema = z.object({
  items: z.array(MeetingListItemSchema),
  total: z.number().int(),
}).strict()

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
}).strict()

export const MeetingPreviousResolutionSchema = MeetingResolutionSchema.extend({
  meeting_id: z.number().int(),
  meeting_name: z.string(),
}).strict()

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
}).strict()

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
}).strict()

export const MeetingPatchSchema = MeetingCreateSchema.partial().extend({
  agenda: z.string().optional(),
  minutes: z.string().optional(),
  secretary_id: z.number().int().nullable().optional(),
  project_id: z.number().int().nullable().optional(),
  scope: z.enum(['this', 'this_and_following']).optional(),
}).strict()

export const MeetingResolutionCreateSchema = z.object({
  name: z.string().trim().min(1),
  responsible_id: z.number().int(),
  deadline: z.string().min(1),
  priority: z.enum(['0', '1', '2', '3']).optional(),
}).strict()

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
}).strict()

export const MeetingSeriesListSchema = z.object({
  items: z.array(MeetingSeriesListItemSchema),
  total: z.number().int(),
}).strict()

export const MeetingSeriesDetailSchema = MeetingSeriesListItemSchema.extend({
  location: z.string(),
  meeting_url: z.string(),
  secretary: MeetingPersonSchema.nullable(),
  attendees: z.array(MeetingPersonSchema),
  meetings: z.array(MeetingListItemSchema),
}).strict()

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
export type MeetingCreate = z.infer<typeof MeetingCreateSchema>
export type MeetingPatch = z.infer<typeof MeetingPatchSchema>
export type MeetingResolutionCreate = z.infer<typeof MeetingResolutionCreateSchema>
export type MeetingSeriesListItem = z.infer<typeof MeetingSeriesListItemSchema>
export type MeetingSeriesDetail = z.infer<typeof MeetingSeriesDetailSchema>
export type MeetingSeriesCreate = z.infer<typeof MeetingSeriesCreateSchema>
