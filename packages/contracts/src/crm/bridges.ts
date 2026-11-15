import { z } from 'zod'

import { MeetingCreateSchema } from '../meetings'
import { PersonalTaskPrioritySchema } from '../tasks'

// The write bodies of the opportunity bridge routes (odoo-addons/liwan_crm_tasks and liwan_crm_meetings). Their
// answers are the tasks and meetings applications' own shapes, read with `MyTaskListPageSchema` and
// `PersonalTaskSchema` (tasks) and `MeetingListSchema` and `MeetingDetailSchema` (meetings), never copied here.

// The tasks service reads an ISO 8601 UTC date or datetime (the personal task form sends a plain date).
const IsoDateOrDateTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?$/)

/** `POST /crm/opportunities/<id>/tasks`: a follow-up task. The deadline is required; assignees default to the agent. */
export const CrmOpportunityTaskCreateSchema = z.strictObject({
  name: z.string().trim().min(1),
  date_deadline: IsoDateOrDateTimeSchema,
  description: z.string().optional(),
  priority: PersonalTaskPrioritySchema.optional(),
  assignees: z.array(z.number().int().positive()).optional(),
})

/** `POST /crm/opportunities/<id>/meetings`: a meeting body without the series, the project and the minutes form. */
export const CrmOpportunityMeetingCreateSchema = MeetingCreateSchema.omit({ series_id: true, project_id: true, minutes_form: true })

export type CrmOpportunityTaskCreate = z.infer<typeof CrmOpportunityTaskCreateSchema>
export type CrmOpportunityMeetingCreate = z.infer<typeof CrmOpportunityMeetingCreateSchema>
