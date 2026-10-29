import { describe, expect, it } from 'vitest'
import type { AppointmentSettings } from '@webvue/contracts'
import { bookingDraft, bookingDraftValid, isInRange, requesterDraft, settingsPatch } from '../appointmentSettings'

const settings: AppointmentSettings = {
  default_slot_minutes: 30, min_notice_hours: 2, horizon_days: 60, modification_deadline_hours: 24,
  requester_confirmation: false, phone_field: 'required', email_field: 'optional', national_id_field: 'hidden', notes_field: 'optional',
  self_booking_policy: 'invite_only', attendance_tracking: true, auto_no_show: true, no_show_grace_minutes: 30, walk_in_allowed: false,
  visit_reason_field: 'optional', cancel_reason_required: false, reference_prefix: 'APT', sector_preset: 'general', presets: ['general', 'clinic', 'services'], revision: 4,
}

describe('appointment settings drafts', () => {
  it('splits the settings between the booking and requester cards', () => {
    expect(bookingDraft(settings)).toEqual({ default_slot_minutes: 30, min_notice_hours: 2, horizon_days: 60, modification_deadline_hours: 24 })
    expect(requesterDraft(settings)).toEqual({
      requester_confirmation: false, self_booking_policy: 'invite_only', phone_field: 'required', email_field: 'optional', national_id_field: 'hidden', notes_field: 'optional',
    })
  })

  it('sends a card\'s values with the latest revision', () => {
    expect(settingsPatch(settings, { min_notice_hours: 6 })).toEqual({ min_notice_hours: 6, revision: 4 })
    expect(settingsPatch(settings, { preset: 'clinic' })).toEqual({ preset: 'clinic', revision: 4 })
  })

  it('accepts only whole numbers inside the server bounds', () => {
    expect(isInRange(0, { min: 0, max: 720 })).toBe(true)
    expect(isInRange(721, { min: 0, max: 720 })).toBe(false)
    expect(isInRange(2.5, { min: 0, max: 720 })).toBe(false)
    expect(isInRange(null, { min: 0, max: 720 })).toBe(false)
    expect(bookingDraftValid(bookingDraft(settings))).toBe(true)
    expect(bookingDraftValid({ ...bookingDraft(settings), horizon_days: 0 })).toBe(false)
  })
})
