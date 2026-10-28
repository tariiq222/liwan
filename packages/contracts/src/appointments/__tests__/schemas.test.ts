import {
  AppointmentCombinationCreateSchema,
  AppointmentCombinationListSchema,
  AppointmentCombinationPatchSchema,
  AppointmentCombinationSchema,
  AppointmentResourceCreateSchema,
  AppointmentResourceListSchema,
  AppointmentResourcePatchSchema,
  AppointmentResourceSchema,
  AppointmentSettingsPatchSchema,
  AppointmentSettingsSchema,
  AppointmentSlotListSchema,
  AppointmentSlotQuerySchema,
  AppointmentSlotSchema,
  AppointmentTypeCreateSchema,
  AppointmentTypeListSchema,
  AppointmentTypePatchSchema,
  AppointmentTypeSchema,
} from '../index'

const TYPE = {
  id: 1,
  name: 'Consultation',
  duration_minutes: 30,
  slot_minutes: 30,
  modifications_deadline_hours: 24,
  location: null,
  videocall_location: 'https://meet.example.com/x',
  resource_calendar_id: 3,
  combination_ids: [4, 5],
  active: true,
}

describe('AppointmentTypeSchema', () => {
  it('is strict: it accepts exactly the serializer shape', () => {
    expect(AppointmentTypeSchema.parse(TYPE)).toEqual(TYPE)
    expect(Object.keys(AppointmentTypeSchema.shape).sort()).toEqual(Object.keys(TYPE).sort())
    expect(() => AppointmentTypeSchema.parse({ ...TYPE, secret: 'x' })).toThrow()
  })

  it('rejects missing fields, non-positive ids and out-of-range minutes', () => {
    const { name: _name, ...withoutName } = TYPE
    expect(() => AppointmentTypeSchema.parse(withoutName)).toThrow()
    for (const bad of [
      { id: 0 }, { duration_minutes: 0 }, { slot_minutes: 4 }, { modifications_deadline_hours: 721 },
      { resource_calendar_id: 0 }, { combination_ids: [0] }, { active: 'yes' },
    ]) {
      expect(() => AppointmentTypeSchema.parse({ ...TYPE, ...bad })).toThrow()
    }
  })
})

describe('AppointmentTypeListSchema', () => {
  it('wraps types with a total and rejects extra keys', () => {
    expect(AppointmentTypeListSchema.parse({ items: [TYPE], total: 1 })).toEqual({ items: [TYPE], total: 1 })
    expect(() => AppointmentTypeListSchema.parse({ items: [TYPE], total: 1, next: 2 })).toThrow()
    expect(() => AppointmentTypeListSchema.parse({ items: [TYPE], total: -1 })).toThrow()
  })
})

describe('AppointmentTypeCreateSchema and AppointmentTypePatchSchema', () => {
  it('create requires a name and accepts the writable fields, never `active` or a company', () => {
    expect(AppointmentTypeCreateSchema.parse({ name: 'Visit' })).toEqual({ name: 'Visit' })
    expect(AppointmentTypeCreateSchema.parse({
      name: 'Visit', duration_minutes: 45, slot_minutes: 15, modifications_deadline_hours: 6, location: null,
      videocall_location: 'x', resource_calendar_id: 2, combination_ids: [1, 2],
    }).combination_ids).toEqual([1, 2])
    expect(() => AppointmentTypeCreateSchema.parse({})).toThrow()
    expect(() => AppointmentTypeCreateSchema.parse({ name: '  ' })).toThrow()
    expect(() => AppointmentTypeCreateSchema.parse({ name: 'Visit', active: false })).toThrow()
    expect(() => AppointmentTypeCreateSchema.parse({ name: 'Visit', company_id: 1 })).toThrow()
    expect(() => AppointmentTypeCreateSchema.parse({ name: 'Visit', duration_minutes: 1.5 })).toThrow()
  })

  it('patch accepts any subset, including none, and stays strict', () => {
    expect(AppointmentTypePatchSchema.parse({})).toEqual({})
    expect(AppointmentTypePatchSchema.parse({ location: null, slot_minutes: 10 })).toEqual({ location: null, slot_minutes: 10 })
    expect(() => AppointmentTypePatchSchema.parse({ id: 1 })).toThrow()
    expect(() => AppointmentTypePatchSchema.parse({ slot_minutes: 481 })).toThrow()
  })
})

const RESOURCE = { id: 7, name: 'Meeting room', type: 'material', calendar_id: 3, active: true }

describe('AppointmentResourceSchema', () => {
  it('is strict and knows only the user and material kinds', () => {
    expect(AppointmentResourceSchema.parse(RESOURCE)).toEqual(RESOURCE)
    expect(AppointmentResourceSchema.parse({ ...RESOURCE, type: 'user', calendar_id: null }).calendar_id).toBeNull()
    expect(Object.keys(AppointmentResourceSchema.shape).sort()).toEqual(Object.keys(RESOURCE).sort())
    expect(() => AppointmentResourceSchema.parse({ ...RESOURCE, type: 'robot' })).toThrow()
    expect(() => AppointmentResourceSchema.parse({ ...RESOURCE, user_id: 1 })).toThrow()
  })

  it('wraps resources in the list envelope', () => {
    expect(AppointmentResourceListSchema.parse({ items: [RESOURCE], total: 1 }).total).toBe(1)
    expect(() => AppointmentResourceListSchema.parse({ items: [RESOURCE] })).toThrow()
  })

  it('create requires a name and cannot choose the type; patch is any subset', () => {
    expect(AppointmentResourceCreateSchema.parse({ name: 'Scanner', calendar_id: 2 })).toEqual({ name: 'Scanner', calendar_id: 2 })
    expect(() => AppointmentResourceCreateSchema.parse({})).toThrow()
    expect(() => AppointmentResourceCreateSchema.parse({ name: 'Scanner', type: 'user' })).toThrow()
    expect(AppointmentResourcePatchSchema.parse({})).toEqual({})
    expect(() => AppointmentResourcePatchSchema.parse({ type: 'material' })).toThrow()
  })
})

const COMBINATION = { id: 9, name: 'Room A', resource_ids: [7], forced_calendar_id: null, active: true }

describe('AppointmentCombinationSchema', () => {
  it('is strict and needs at least one resource', () => {
    expect(AppointmentCombinationSchema.parse(COMBINATION)).toEqual(COMBINATION)
    expect(Object.keys(AppointmentCombinationSchema.shape).sort()).toEqual(Object.keys(COMBINATION).sort())
    expect(() => AppointmentCombinationSchema.parse({ ...COMBINATION, resource_ids: [] })).toThrow()
    expect(() => AppointmentCombinationSchema.parse({ ...COMBINATION, company_id: 1 })).toThrow()
  })

  it('wraps combinations in the list envelope', () => {
    expect(AppointmentCombinationListSchema.parse({ items: [COMBINATION], total: 1 }).items).toHaveLength(1)
    expect(() => AppointmentCombinationListSchema.parse({ items: [COMBINATION], total: -1 })).toThrow()
  })

  it('create requires resource_ids; patch may clear the forced calendar with null', () => {
    expect(AppointmentCombinationCreateSchema.parse({ resource_ids: [1, 2], forced_calendar_id: 4 }).forced_calendar_id).toBe(4)
    expect(() => AppointmentCombinationCreateSchema.parse({})).toThrow()
    expect(() => AppointmentCombinationCreateSchema.parse({ resource_ids: [] })).toThrow()
    expect(AppointmentCombinationPatchSchema.parse({ forced_calendar_id: null })).toEqual({ forced_calendar_id: null })
    expect(() => AppointmentCombinationPatchSchema.parse({ active: false })).toThrow()
  })
})

const SLOT = { start: '2026-10-30T08:00:00Z', stop: '2026-10-30T08:30:00Z' }

describe('AppointmentSlotSchema', () => {
  it('accepts UTC timestamps only and rejects extra keys', () => {
    expect(AppointmentSlotSchema.parse(SLOT)).toEqual(SLOT)
    expect(() => AppointmentSlotSchema.parse({ ...SLOT, start: '2026-10-30T08:00:00+03:00' })).toThrow()
    expect(() => AppointmentSlotSchema.parse({ ...SLOT, resource: 1 })).toThrow()
    expect(AppointmentSlotListSchema.parse({ items: [SLOT], total: 1 }).total).toBe(1)
  })

  it('the query needs from and to as dates and takes an optional combination', () => {
    expect(AppointmentSlotQuerySchema.parse({ from: '2026-10-30', to: '2026-11-05' })).toEqual({ from: '2026-10-30', to: '2026-11-05' })
    expect(AppointmentSlotQuerySchema.parse({ from: '2026-10-30', to: '2026-11-05', combination_id: 3 }).combination_id).toBe(3)
    expect(() => AppointmentSlotQuerySchema.parse({ from: '2026-10-30' })).toThrow()
    expect(() => AppointmentSlotQuerySchema.parse({ from: 'tomorrow', to: '2026-11-05' })).toThrow()
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
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, sector_preset: 'clinic' })).toThrow()
  })
})
