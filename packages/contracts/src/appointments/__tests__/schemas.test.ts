import { AppointmentSettingsPatchSchema, AppointmentSettingsSchema, AppointmentTypeListSchema, AppointmentTypeSchema } from '../index'

const TYPE = { id: 1, name: 'Consultation', duration_minutes: 30 }

describe('AppointmentTypeSchema', () => {
  it('is strict: it accepts exactly id, name and duration_minutes', () => {
    expect(AppointmentTypeSchema.parse(TYPE)).toEqual(TYPE)
    expect(Object.keys(AppointmentTypeSchema.shape).sort()).toEqual(['duration_minutes', 'id', 'name'])
    expect(() => AppointmentTypeSchema.parse({ ...TYPE, secret: 'x' })).toThrow()
  })

  it('rejects a missing name, a non-positive id and a non-positive duration', () => {
    expect(() => AppointmentTypeSchema.parse({ id: 1, duration_minutes: 30 })).toThrow()
    expect(() => AppointmentTypeSchema.parse({ ...TYPE, id: 0 })).toThrow()
    expect(() => AppointmentTypeSchema.parse({ ...TYPE, duration_minutes: 0 })).toThrow()
  })
})

describe('AppointmentTypeListSchema', () => {
  it('wraps types with a total and rejects extra keys', () => {
    expect(AppointmentTypeListSchema.parse({ items: [TYPE], total: 1 })).toEqual({ items: [TYPE], total: 1 })
    expect(() => AppointmentTypeListSchema.parse({ items: [TYPE], total: 1, next: 2 })).toThrow()
    expect(() => AppointmentTypeListSchema.parse({ items: [TYPE], total: -1 })).toThrow()
  })
})

const SETTINGS = {
  default_slot_minutes: 30,
  min_notice_hours: 2,
  horizon_days: 60,
  modification_deadline_hours: 24,
  requester_confirmation: false,
  phone_field: 'required',
  email_field: 'optional',
  national_id_field: 'hidden',
  notes_field: 'optional',
  self_booking_policy: 'invite_only',
  sector_preset: 'general',
  presets: ['general', 'clinic', 'services'],
  revision: 0,
}

describe('AppointmentSettingsSchema', () => {
  it('accepts the server shape exactly and rejects extra keys', () => {
    expect(AppointmentSettingsSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(Object.keys(AppointmentSettingsSchema.shape).sort()).toEqual(Object.keys(SETTINGS).sort())
    expect(() => AppointmentSettingsSchema.parse({ ...SETTINGS, company_id: 1 })).toThrow()
  })

  it('rejects out-of-range numbers and unknown enum values', () => {
    for (const bad of [
      { default_slot_minutes: 4 }, { default_slot_minutes: 481 }, { min_notice_hours: 721 },
      { horizon_days: 0 }, { horizon_days: 366 }, { modification_deadline_hours: -1 },
      { phone_field: 'maybe' }, { self_booking_policy: 'anyone' }, { sector_preset: 'bank' }, { revision: -1 },
    ]) {
      expect(() => AppointmentSettingsSchema.parse({ ...SETTINGS, ...bad })).toThrow()
    }
  })
})

describe('AppointmentSettingsPatchSchema', () => {
  it('requires revision and accepts any subset of the settings and a preset', () => {
    expect(AppointmentSettingsPatchSchema.parse({ revision: 1 })).toEqual({ revision: 1 })
    expect(AppointmentSettingsPatchSchema.parse({ preset: 'clinic', horizon_days: 14, revision: 2 }))
      .toEqual({ preset: 'clinic', horizon_days: 14, revision: 2 })
    expect(() => AppointmentSettingsPatchSchema.parse({ horizon_days: 14 })).toThrow()
  })

  it('is strict and range-checked, and cannot send the read-only presets list', () => {
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, presets: ['clinic'] })).toThrow()
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, mystery: 1 })).toThrow()
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, horizon_days: 366 })).toThrow()
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, preset: 'bank' })).toThrow()
  })
})
