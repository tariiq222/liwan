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
  state: z.enum(['draft', 'confirmed', 'done', 'cancelled']),
  organizer: MeetingPersonSchema.nullable(),
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
}).strict()

export const MeetingDetailSchema = MeetingListItemSchema.extend({
  agenda: z.string(),
  minutes: z.string(),
  location: z.string(),
  start_datetime: z.string().nullable(),
  end_datetime: z.string().nullable(),
  meeting_url: z.string(),
  can_edit: z.boolean(),
  secretary: MeetingPersonSchema.nullable(),
  attendees: z.array(MeetingPersonSchema),
  resolutions: z.array(MeetingResolutionSchema),
}).strict()

export const MeetingCreateSchema = z.object({
  name: z.string().trim().min(1),
  meeting_date: z.string().optional(),
  location: z.string().optional(),
  start_datetime: z.string().optional(),
  end_datetime: z.string().optional(),
  meeting_url: z.string().optional(),
  secretary_id: z.number().int().optional(),
  attendee_ids: z.array(z.number().int()).optional(),
}).strict()

export const MeetingPatchSchema = MeetingCreateSchema.partial().extend({
  agenda: z.string().optional(),
  minutes: z.string().optional(),
  secretary_id: z.number().int().nullable().optional(),
}).strict()

export const MeetingResolutionCreateSchema = z.object({
  name: z.string().trim().min(1),
  responsible_id: z.number().int(),
  deadline: z.string().min(1),
  priority: z.enum(['0', '1', '2', '3']).optional(),
}).strict()

export type MeetingListItem = z.infer<typeof MeetingListItemSchema>
export type MeetingList = z.infer<typeof MeetingListSchema>
export type MeetingDetail = z.infer<typeof MeetingDetailSchema>
export type MeetingCreate = z.infer<typeof MeetingCreateSchema>
export type MeetingPatch = z.infer<typeof MeetingPatchSchema>
export type MeetingResolutionCreate = z.infer<typeof MeetingResolutionCreateSchema>
