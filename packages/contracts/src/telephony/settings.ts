import { z } from 'zod'

/**
 * The database's recording settings, field for field with the liwan_telephony settings serializer: whether calls are
 * recorded, whether the party that answers hears the notice once it answers, and how many days the agent keeps a
 * recording before the retention cron deletes it. One policy per Odoo database, because one phone system serves it: a
 * `telephony.use` holder of any company reads it, and only a `telephony.manage` holder of the root company writes it.
 * The retention bounds are the model's declared range.
 */
export const TelephonyRecordingSettingsSchema = z.strictObject({
  recordingPolicy: z.enum(['always', 'off']),
  recordingAnnouncement: z.boolean(),
  recordingRetentionDays: z.number().int().min(1).max(3650),
})

export type TelephonyRecordingSettings = z.infer<typeof TelephonyRecordingSettingsSchema>
