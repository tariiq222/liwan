import { z } from 'zod'

export const AppointmentFieldRequirementSchema = z.enum(['required', 'optional', 'hidden'])
/** Who may book. `invite_only` is the only policy: no route serves a public booking page, so `open` is not a value at
 * all (issue #550). */
export const AppointmentSelfBookingPolicySchema = z.enum(['invite_only'])
export const AppointmentSectorPresetSchema = z.enum(['general', 'clinic', 'services'])

const slotMinutes = z.number().int().min(5).max(480)
const minNoticeHours = z.number().int().min(0).max(720)
const horizonDays = z.number().int().min(1).max(365)
const modificationDeadlineHours = z.number().int().min(0).max(720)
const noShowGraceMinutes = z.number().int().min(0).max(1440)
const linkValidDaysAfterEnd = z.number().int().min(0).max(3650)
const referencePrefix = z.string().regex(/^[A-Z0-9-]{1,10}$/)

/** GET /appointments/settings: the company's settings, or the defaults at revision 0 while none are saved. */
export const AppointmentSettingsSchema = z.object({
  default_slot_minutes: slotMinutes,
  min_notice_hours: minNoticeHours,
  horizon_days: horizonDays,
  modification_deadline_hours: modificationDeadlineHours,
  requester_confirmation: z.boolean(),
  phone_field: AppointmentFieldRequirementSchema,
  email_field: AppointmentFieldRequirementSchema,
  national_id_field: AppointmentFieldRequirementSchema,
  notes_field: AppointmentFieldRequirementSchema,
  self_booking_policy: AppointmentSelfBookingPolicySchema,
  attendance_tracking: z.boolean(),
  auto_no_show: z.boolean(),
  no_show_grace_minutes: noShowGraceMinutes,
  walk_in_allowed: z.boolean(),
  visit_reason_field: AppointmentFieldRequirementSchema,
  /** Binds the staff cancel route and the invited requester's. */
  cancel_reason_required: z.boolean(),
  /** Days after the appointment ends that the requester's link stays readable; the default is 30. */
  link_valid_days_after_end: linkValidDaysAfterEnd,
  reference_prefix: referencePrefix,
  sector_preset: AppointmentSectorPresetSchema,
  presets: z.array(AppointmentSectorPresetSchema),
  revision: z.number().int().nonnegative(),
}).strict()

/**
 * PATCH /appointments/settings: any settings plus the required `revision` read from the last GET. `preset`
 * applies a sector preset's values first (the reference prefix excepted); a field sent with it overrides the preset's value.
 */
export const AppointmentSettingsPatchSchema = z.object({
  default_slot_minutes: slotMinutes,
  min_notice_hours: minNoticeHours,
  horizon_days: horizonDays,
  modification_deadline_hours: modificationDeadlineHours,
  requester_confirmation: z.boolean(),
  phone_field: AppointmentFieldRequirementSchema,
  email_field: AppointmentFieldRequirementSchema,
  national_id_field: AppointmentFieldRequirementSchema,
  notes_field: AppointmentFieldRequirementSchema,
  self_booking_policy: AppointmentSelfBookingPolicySchema,
  attendance_tracking: z.boolean(),
  auto_no_show: z.boolean(),
  no_show_grace_minutes: noShowGraceMinutes,
  walk_in_allowed: z.boolean(),
  visit_reason_field: AppointmentFieldRequirementSchema,
  cancel_reason_required: z.boolean(),
  link_valid_days_after_end: linkValidDaysAfterEnd,
  reference_prefix: referencePrefix,
  preset: AppointmentSectorPresetSchema,
  revision: z.number().int().nonnegative(),
}).partial().required({ revision: true }).strict()

export type AppointmentSettings = z.infer<typeof AppointmentSettingsSchema>
export type AppointmentSettingsPatch = z.infer<typeof AppointmentSettingsPatchSchema>
