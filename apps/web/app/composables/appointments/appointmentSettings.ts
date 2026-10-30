import type { AppointmentSectorPresetSchema, AppointmentSettings, AppointmentSettingsPatch } from '@liwan/contracts'
import type { z } from 'zod'

export type AppointmentSectorPreset = z.infer<typeof AppointmentSectorPresetSchema>

/** The bounds the server enforces, for the number inputs. */
export const APPOINTMENT_RANGES = {
  default_slot_minutes: { min: 5, max: 480 },
  min_notice_hours: { min: 0, max: 720 },
  horizon_days: { min: 1, max: 365 },
  modification_deadline_hours: { min: 0, max: 720 },
} as const

export const BOOKING_KEYS = ['default_slot_minutes', 'min_notice_hours', 'horizon_days', 'modification_deadline_hours'] as const
export const REQUESTER_KEYS = ['requester_confirmation', 'self_booking_policy', 'phone_field', 'email_field', 'national_id_field', 'notes_field'] as const

export type BookingDraft = Pick<AppointmentSettings, (typeof BOOKING_KEYS)[number]>
export type RequesterDraft = Pick<AppointmentSettings, (typeof REQUESTER_KEYS)[number]>

const pick = <Key extends keyof AppointmentSettings>(settings: AppointmentSettings, keys: readonly Key[]) =>
  Object.fromEntries(keys.map(key => [key, settings[key]])) as Pick<AppointmentSettings, Key>

export const bookingDraft = (settings: AppointmentSettings): BookingDraft => pick(settings, BOOKING_KEYS)
export const requesterDraft = (settings: AppointmentSettings): RequesterDraft => pick(settings, REQUESTER_KEYS)

/** One card's fields as a PATCH body; the revision is the latest the page knows, so another card's save never conflicts. */
export function settingsPatch(latest: AppointmentSettings, values: Partial<AppointmentSettingsPatch>): AppointmentSettingsPatch {
  return { ...values, revision: latest.revision }
}

/** A whole number inside the range, as the server accepts it; a cleared or fractional input is not. */
export function isInRange(value: unknown, range: { min: number; max: number }): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
}

export function bookingDraftValid(draft: BookingDraft): boolean {
  return BOOKING_KEYS.every(key => isInRange(draft[key], APPOINTMENT_RANGES[key]))
}
