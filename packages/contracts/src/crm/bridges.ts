import { z } from 'zod'

import { ApiErrorSchema } from '../common/error'
import { CustomerLinkRefSchema } from '../customers'
import { MeetingCreateSchema } from '../meetings'
import { PersonalTaskPrioritySchema } from '../tasks'

// The write bodies of the opportunity bridge routes (odoo-addons/liwan_crm_tasks and liwan_crm_meetings). Their
// answers are the tasks and meetings applications' own shapes, read with `MyTaskListPageSchema` and
// `PersonalTaskSchema` (tasks) and `MeetingListSchema` and `MeetingDetailSchema` (meetings), never copied here.
// The conversation bridge (odoo-addons/liwan_crm_inbox) is at the end: the opportunities of a conversation list as
// `InboxConversationListSchema` rows.

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

/** The opportunity a conversation is linked to, as the inbox shows it (`status` is the opportunity's won status). */
export const ConversationOpportunitySchema = z.strictObject({
  id: z.number().int().positive(),
  contact_name: z.string(),
  stage: z.strictObject({ id: z.number().int(), name: z.string() }).nullable(),
  status: z.enum(['pending', 'won', 'lost']),
  // False for an archived opportunity, which stays shown but takes no new link.
  active: z.boolean(),
})

/** `GET /inbox/conversations/<id>/opportunity`: the ref, or a bare `null` when none is linked or the caller cannot read it. */
export const ConversationOpportunityAnswerSchema = ConversationOpportunitySchema.nullable()

/** `PUT /inbox/conversations/<id>/opportunity`: links an existing opportunity; nothing is created. */
export const ConversationOpportunityLinkSchema = z.strictObject({ opportunity_id: z.number().int().positive() })

/** `details` of the 409 `conflict`: the contact and the opportunity belong to different customers; a side the caller cannot see or may not pick is null. */
export const ConversationOpportunityConflictDetailsSchema = z.strictObject({
  contact_customer: CustomerLinkRefSchema.nullable(),
  opportunity_customer: CustomerLinkRefSchema.nullable(),
})

export const ConversationOpportunityConflictErrorSchema = ApiErrorSchema.extend({
  code: z.literal('conflict'),
  details: ConversationOpportunityConflictDetailsSchema,
})

export type CrmOpportunityTaskCreate = z.infer<typeof CrmOpportunityTaskCreateSchema>
export type CrmOpportunityMeetingCreate = z.infer<typeof CrmOpportunityMeetingCreateSchema>
export type ConversationOpportunity = z.infer<typeof ConversationOpportunitySchema>
export type ConversationOpportunityConflictDetails = z.infer<typeof ConversationOpportunityConflictDetailsSchema>
