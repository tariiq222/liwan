import { z } from 'zod'
import { TelephonyRefSchema } from './shared'

/** Always records, records only when an agent asks (design 4.4), or never records. */
export const TelephonyRecordingPolicySchema = z.enum(['always', 'on_demand', 'off'])

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const WeekRangeSchema = z.strictObject({ weekday: z.number().int().min(0).max(6), from: Clock, to: Clock })
  .refine(range => range.from < range.to, 'a range ends after it starts')

/** When the company answers, and what callers hear outside it. No days means always open. */
export const TelephonyBusinessHoursSchema = z.strictObject({
  timezone: z.string().min(1).max(64),
  // 0 = Monday ... 6 = Sunday, as Odoo counts; several ranges per day are allowed.
  days: z.array(WeekRangeSchema).max(42),
  closedMessage: z.string().max(1000).nullable(),
})

/**
 * The company's telephony settings (design section 7). A permanent recording policy cannot drop its announcement:
 * the caller must hear that the call is recorded, so `announcementEnabled` is forced true there.
 */
export const TelephonySettingsSchema = z.strictObject({
  recordingPolicy: TelephonyRecordingPolicySchema,
  announcementEnabled: z.boolean(),
  // How long pbx-agent keeps a recording, in days; shortening it applies to the stored files from the next run.
  retentionDays: z.number().int().min(1).max(365),
  defaultLine: TelephonyRefSchema.nullable(),
  queueCount: z.number().int().nonnegative(),
  ivrEnabled: z.boolean(),
  businessHours: TelephonyBusinessHoursSchema,
}).refine(
  settings => settings.recordingPolicy !== 'always' || settings.announcementEnabled,
  { path: ['announcementEnabled'], message: 'a permanent recording keeps its announcement' },
)

export type TelephonyRecordingPolicy = z.infer<typeof TelephonyRecordingPolicySchema>
export type TelephonyBusinessHours = z.infer<typeof TelephonyBusinessHoursSchema>
export type TelephonySettings = z.infer<typeof TelephonySettingsSchema>
