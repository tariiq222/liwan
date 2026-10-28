import { z } from 'zod'

// The bell dump of the CRM kinds (webvue_crm `_webvue_notify_dump`): `title` is the contact name.
export const CrmNotificationKindSchema = z.enum(['crm.assigned', 'crm.followup_due'])

export const CrmNotificationSchema = z.strictObject({
  id: z.number().int().positive(),
  kind: CrmNotificationKindSchema,
  opportunity_id: z.number().int().positive(),
  title: z.string(),
  created_at: z.string(),
  is_read: z.boolean(),
})

export type CrmNotification = z.infer<typeof CrmNotificationSchema>
