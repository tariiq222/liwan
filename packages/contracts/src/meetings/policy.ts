import { z } from 'zod'

/** Who may schedule a meeting or a series in the company: every employee, or only holders of the meeting organizer role. */
export const MeetingSchedulePolicySchema = z.enum(['all_employees', 'organizers_only'])
export type MeetingSchedulePolicy = z.infer<typeof MeetingSchedulePolicySchema>

const MeetingSettingsValuesSchema = z.strictObject({ schedule_policy: MeetingSchedulePolicySchema })

/** `GET`/`PATCH /api/v1/meetings/settings`: the company's values, the stated defaults, the allowed options and the revision. */
export const MeetingSettingsSchema = z.strictObject({
  values: MeetingSettingsValuesSchema,
  defaults: MeetingSettingsValuesSchema,
  options: z.strictObject({ schedule_policy: z.array(MeetingSchedulePolicySchema) }),
  revision: z.number().int().min(0),
})
export type MeetingSettings = z.infer<typeof MeetingSettingsSchema>

/** One PATCH carries the revision the draft was made from; a stale revision answers 409. */
export const MeetingSettingsPatchSchema = z.strictObject({
  revision: z.number().int().min(0),
  values: MeetingSettingsValuesSchema,
})
export type MeetingSettingsPatch = z.infer<typeof MeetingSettingsPatchSchema>
