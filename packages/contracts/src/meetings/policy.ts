import { z } from 'zod'

/** Who may schedule a meeting or a series in the company: every employee, or only holders of the meeting organizer role. */
export const MeetingSchedulePolicySchema = z.enum(['all_employees', 'organizers_only'])
export type MeetingSchedulePolicy = z.infer<typeof MeetingSchedulePolicySchema>

/** The reminder window bounds of a company, in hours before the meeting start. */
export const MEETING_REMINDER_HOURS_MIN = 1
export const MEETING_REMINDER_HOURS_MAX = 168
/** The first segment of a new meeting reference: A-Z and 0-9 only, as the server's CHECK states. */
export const MEETING_REFERENCE_PREFIX_PATTERN = /^[A-Z0-9]{1,10}$/
export const MEETING_REFERENCE_PREFIX_MAX_LENGTH = 10

const MeetingReminderHoursSchema = z.number().int().min(MEETING_REMINDER_HOURS_MIN).max(MEETING_REMINDER_HOURS_MAX)
const MeetingReferencePrefixSchema = z.string().regex(MEETING_REFERENCE_PREFIX_PATTERN)

const MeetingSettingsValuesSchema = z.strictObject({
  schedule_policy: MeetingSchedulePolicySchema,
  reminder_hours: MeetingReminderHoursSchema,
  reference_prefix: MeetingReferencePrefixSchema,
})

/** `GET`/`PATCH /api/v1/meetings/settings`: the company's values, the stated defaults, the allowed options and the revision. */
export const MeetingSettingsSchema = z.strictObject({
  values: MeetingSettingsValuesSchema,
  defaults: MeetingSettingsValuesSchema,
  options: z.strictObject({
    schedule_policy: z.array(MeetingSchedulePolicySchema),
    reminder_hours: z.strictObject({ min: z.number().int(), max: z.number().int() }),
    reference_prefix: z.strictObject({ pattern: z.string(), max_length: z.number().int() }),
  }),
  revision: z.number().int().min(0),
})
export type MeetingSettings = z.infer<typeof MeetingSettingsSchema>

/** One PATCH carries the revision the draft was made from and only the settings it changes; a stale revision answers 409. */
export const MeetingSettingsPatchSchema = z.strictObject({
  revision: z.number().int().min(0),
  values: MeetingSettingsValuesSchema.partial().refine(values => Object.keys(values).length > 0, {
    message: 'values must be a non-empty object',
  }),
})
export type MeetingSettingsPatch = z.infer<typeof MeetingSettingsPatchSchema>
