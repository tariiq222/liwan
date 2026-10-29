import {
  AppointmentAttendanceRecordSchema,
  AppointmentBookingCancelSchema,
  AppointmentBookingCreateSchema,
  AppointmentBookingListQuerySchema,
  AppointmentBookingListSchema,
  AppointmentBookingPatchSchema,
  AppointmentBookingScheduleSchema,
  AppointmentBookingSchema,
  AppointmentCombinationCreateSchema,
  AppointmentCombinationListSchema,
  AppointmentCombinationPatchSchema,
  AppointmentCombinationSchema,
  AppointmentInvitationSchema,
  AppointmentPublicBookingQuerySchema,
  AppointmentPublicBookingSchema,
  AppointmentPublicScheduleSchema,
  AppointmentPublicSlotQuerySchema,
  AppointmentPublicTokenSchema,
  AppointmentReasonCreateSchema,
  AppointmentReasonListQuerySchema,
  AppointmentReasonListSchema,
  AppointmentReasonPatchSchema,
  AppointmentReasonSchema,
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
  attendance_tracking: true,
  auto_no_show: true,
  no_show_grace_minutes: 30,
  walk_in_allowed: false,
  visit_reason_field: 'optional',
  cancel_reason_required: false,
  reference_prefix: 'APT',
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
      { no_show_grace_minutes: -1 }, { no_show_grace_minutes: 1441 }, { visit_reason_field: 'maybe' }, { walk_in_allowed: 'yes' },
      { reference_prefix: '' }, { reference_prefix: 'apt' }, { reference_prefix: 'ABCDEFGHIJK' }, { reference_prefix: 'A/B' },
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
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, no_show_grace_minutes: 1441 })).toThrow()
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, reference_prefix: 'a' })).toThrow()
    expect(AppointmentSettingsPatchSchema.parse({ revision: 0, reference_prefix: 'CLN-1', walk_in_allowed: true }))
      .toEqual({ revision: 0, reference_prefix: 'CLN-1', walk_in_allowed: true })
    expect(() => AppointmentSettingsPatchSchema.parse({ revision: 0, sector_preset: 'clinic' })).toThrow()
  })
})

const BOOKING_ROW = {
  id: 7,
  reference: 'APT/2026/000007',
  state: 'scheduled',
  attendance: null,
  walk_in: false,
  type_id: 1,
  type_name: 'Consultation',
  combination_id: 4,
  start: '2026-11-02T09:00:00Z',
  stop: '2026-11-02T09:30:00Z',
  duration_minutes: 30,
  requester_name: 'Sara',
}
const BOOKING = {
  ...BOOKING_ROW,
  requester: { id: 9, name: 'Sara', phone: '+966500000000', email: null },
  national_id: null,
  notes: 'First visit',
  visit_reason: { id: 2, name: 'Consultation' },
  cancel_reason: null,
  is_modifiable: true,
}

describe('AppointmentBooking schemas', () => {
  it('detail and list rows are strict and match the serializer shape', () => {
    expect(AppointmentBookingSchema.parse(BOOKING)).toEqual(BOOKING)
    expect(() => AppointmentBookingSchema.parse({ ...BOOKING, secret: 'x' })).toThrow()
    expect(() => AppointmentBookingSchema.parse(BOOKING_ROW)).toThrow()
    const list = { items: [BOOKING_ROW], total: 1 }
    expect(AppointmentBookingListSchema.parse(list)).toEqual(list)
    expect(() => AppointmentBookingListSchema.parse({ items: [BOOKING], total: 1 })).toThrow()
  })

  it('a pending booking has no start, stop or combination', () => {
    const pending = { ...BOOKING_ROW, state: 'pending', combination_id: null, start: null, stop: null }
    expect(AppointmentBookingListSchema.parse({ items: [pending], total: 1 }).items[0]).toEqual(pending)
    expect(() => AppointmentBookingListSchema.parse({ items: [{ ...pending, state: 'done' }], total: 1 })).toThrow()
  })

  it('the list query accepts the filters and rejects unknown ones', () => {
    const query = { state: 'pending', type_id: 1, resource_id: 2, from: '2026-11-01', to: '2026-11-30', mine: 'true', limit: 50, offset: 0 }
    expect(AppointmentBookingListQuerySchema.parse(query)).toEqual(query)
    expect(() => AppointmentBookingListQuerySchema.parse({ mine: 'yes' })).toThrow()
    expect(() => AppointmentBookingListQuerySchema.parse({ from: '2026-11-1' })).toThrow()
    expect(() => AppointmentBookingListQuerySchema.parse({ q: 'x' })).toThrow()
  })

  it('create needs a type and exactly one requester form', () => {
    const body = { type_id: 1, requester: { name: 'Sara', phone: '+966500000000' }, notes: 'x', start: '2026-11-02T09:00:00Z' }
    expect(AppointmentBookingCreateSchema.parse(body)).toEqual(body)
    expect(AppointmentBookingCreateSchema.parse({ type_id: 1, requester_id: 3 })).toEqual({ type_id: 1, requester_id: 3 })
    expect(() => AppointmentBookingCreateSchema.parse({ type_id: 1 })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ type_id: 1, requester_id: 3, requester: { name: 'Sara' } })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ requester_id: 3 })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ type_id: 1, requester: { phone: '1' } })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ type_id: 1, requester_id: 3, start: '2026-11-02' })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ type_id: 1, requester_id: 3, company_id: 1 })).toThrow()
  })

  it('a requester phone is 5 to 32 phone characters, like the server', () => {
    const create = (phone: string) => AppointmentBookingCreateSchema.parse({ type_id: 1, requester: { name: 'Sara', phone } })
    expect(create('+' + '1'.repeat(31)).requester?.phone).toHaveLength(32)
    for (const bad of ['+' + '1'.repeat(32), '1234', 'abc12345']) expect(() => create(bad)).toThrow()
  })

  it('read-only callers get null contact fields', () => {
    const hidden = { ...BOOKING, requester: { id: 9, name: 'Sara', phone: null, email: null }, national_id: null }
    expect(AppointmentBookingSchema.parse(hidden)).toEqual(hidden)
  })

  it('a row carries its reference, attendance and walk-in flag', () => {
    const arrived = { ...BOOKING_ROW, reference: null, attendance: 'arrived', walk_in: true }
    expect(AppointmentBookingListSchema.parse({ items: [arrived], total: 1 }).items[0]).toEqual(arrived)
    expect(() => AppointmentBookingListSchema.parse({ items: [{ ...BOOKING_ROW, attendance: 'late' }], total: 1 })).toThrow()
    expect(() => AppointmentBookingSchema.parse({ ...BOOKING, visit_reason: { id: 2 } })).toThrow()
  })

  it('create takes a walk-in or a visit reason, and a walk-in has no start', () => {
    const walkIn = { type_id: 1, requester_id: 3, walk_in: true, visit_reason_id: 2 }
    expect(AppointmentBookingCreateSchema.parse(walkIn)).toEqual(walkIn)
    expect(AppointmentBookingCreateSchema.parse({ type_id: 1, requester_id: 3, visit_reason_id: null }).visit_reason_id).toBeNull()
    expect(() => AppointmentBookingCreateSchema.parse({ ...walkIn, start: '2026-11-02T09:00:00Z' })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ ...walkIn, visit_reason_id: 0 })).toThrow()
    expect(() => AppointmentBookingCreateSchema.parse({ ...walkIn, walk_in: 'yes' })).toThrow()
  })

  it('patch, cancel and attendance bodies are strict', () => {
    expect(AppointmentBookingPatchSchema.parse({ visit_reason_id: 3 })).toEqual({ visit_reason_id: 3 })
    expect(AppointmentBookingPatchSchema.parse({ visit_reason_id: null })).toEqual({ visit_reason_id: null })
    expect(() => AppointmentBookingPatchSchema.parse({})).toThrow()
    expect(() => AppointmentBookingPatchSchema.parse({ visit_reason_id: 3, notes: 'x' })).toThrow()
    expect(AppointmentBookingCancelSchema.parse({})).toEqual({})
    expect(AppointmentBookingCancelSchema.parse({ reason_id: 4 })).toEqual({ reason_id: 4 })
    expect(() => AppointmentBookingCancelSchema.parse({ reason_id: 0 })).toThrow()
    for (const outcome of ['arrived', 'in_service', 'done', 'no_show']) {
      expect(AppointmentAttendanceRecordSchema.parse({ outcome })).toEqual({ outcome })
    }
    expect(() => AppointmentAttendanceRecordSchema.parse({ outcome: 'late' })).toThrow()
    expect(() => AppointmentAttendanceRecordSchema.parse({})).toThrow()
  })

  it('schedule needs a UTC start', () => {
    expect(AppointmentBookingScheduleSchema.parse({ start: '2026-11-02T09:00:00Z', combination_id: 4 })).toEqual({
      start: '2026-11-02T09:00:00Z', combination_id: 4,
    })
    expect(() => AppointmentBookingScheduleSchema.parse({})).toThrow()
    expect(() => AppointmentBookingScheduleSchema.parse({ start: 'tomorrow' })).toThrow()
  })
})

const PUBLIC_BOOKING = {
  id: 7,
  state: 'confirmed',
  type_name: 'Consultation',
  duration_minutes: 30,
  location: null,
  start: '2026-10-30T08:00:00Z',
  stop: '2026-10-30T08:30:00Z',
  is_modifiable: true,
  company_name: 'Clinic',
  requester: { name: 'Sara Ali', phone: '+966500000001', email: null },
}

describe('public appointment schemas', () => {
  it('the requester view accepts exactly the whitelist', () => {
    expect(AppointmentPublicBookingSchema.parse(PUBLIC_BOOKING)).toEqual(PUBLIC_BOOKING)
    expect(() => AppointmentPublicBookingSchema.parse({ ...PUBLIC_BOOKING, national_id: '1' })).toThrow()
    expect(() => AppointmentPublicBookingSchema.parse({ ...PUBLIC_BOOKING, requester: { ...PUBLIC_BOOKING.requester, id: 3 } })).toThrow()
    expect(() => AppointmentPublicBookingSchema.parse({ ...PUBLIC_BOOKING, state: 'draft' })).toThrow()
  })

  it('every request carries a bounded access token and nothing else unknown', () => {
    expect(AppointmentPublicBookingQuerySchema.parse({ access_token: 'abc' })).toEqual({ access_token: 'abc' })
    expect(() => AppointmentPublicBookingQuerySchema.parse({})).toThrow()
    expect(() => AppointmentPublicTokenSchema.parse({ access_token: 'x'.repeat(129) })).toThrow()
    expect(() => AppointmentPublicTokenSchema.parse({ access_token: 'abc', combination_id: 1 })).toThrow()
    expect(AppointmentPublicSlotQuerySchema.parse({ access_token: 'abc', from: '2026-10-30', to: '2026-11-05' }).to).toBe('2026-11-05')
    expect(() => AppointmentPublicSlotQuerySchema.parse({ access_token: 'abc', from: '2026-10-30', to: '2026-11-05', combination_id: 3 })).toThrow()
    expect(AppointmentPublicScheduleSchema.parse({ access_token: 'abc', start: '2026-10-30T08:00:00Z' }).start).toBe('2026-10-30T08:00:00Z')
    expect(() => AppointmentPublicScheduleSchema.parse({ access_token: 'abc', start: '2026-10-30' })).toThrow()
  })

  it('the invitation is a path to the requester page, never a URL', () => {
    expect(AppointmentInvitationSchema.parse({ path: '/book/7?access_token=abc-123' }).path).toBe('/book/7?access_token=abc-123')
    expect(() => AppointmentInvitationSchema.parse({ path: 'https://x.test/book/7?access_token=abc' })).toThrow()
    expect(() => AppointmentInvitationSchema.parse({ path: '/my/bookings/7?access_token=abc' })).toThrow()
  })
})

const REASON = { id: 5, kind: 'visit', name: 'Consultation', sequence: 10, active: true }

describe('AppointmentReason schemas', () => {
  it('a reason is strict and has a kind of visit or cancel', () => {
    expect(AppointmentReasonSchema.parse(REASON)).toEqual(REASON)
    expect(Object.keys(AppointmentReasonSchema.shape).sort()).toEqual(Object.keys(REASON).sort())
    expect(() => AppointmentReasonSchema.parse({ ...REASON, company_id: 1 })).toThrow()
    expect(() => AppointmentReasonSchema.parse({ ...REASON, kind: 'other' })).toThrow()
    const list = { items: [REASON], total: 1 }
    expect(AppointmentReasonListSchema.parse(list)).toEqual(list)
  })

  it('the list query filters by kind and active', () => {
    const query = { kind: 'cancel', active: 'false', limit: 20, offset: 0 }
    expect(AppointmentReasonListQuerySchema.parse(query)).toEqual(query)
    expect(() => AppointmentReasonListQuerySchema.parse({ kind: 'other' })).toThrow()
    expect(() => AppointmentReasonListQuerySchema.parse({ q: 'x' })).toThrow()
  })

  it('create needs a kind and a name; patch cannot change the kind', () => {
    expect(AppointmentReasonCreateSchema.parse({ kind: 'cancel', name: 'No longer needed', sequence: 20 }))
      .toEqual({ kind: 'cancel', name: 'No longer needed', sequence: 20 })
    expect(() => AppointmentReasonCreateSchema.parse({ name: 'x' })).toThrow()
    expect(() => AppointmentReasonCreateSchema.parse({ kind: 'visit', name: ' ' })).toThrow()
    expect(() => AppointmentReasonCreateSchema.parse({ kind: 'visit', name: 'x', sequence: 10000 })).toThrow()
    expect(AppointmentReasonPatchSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' })
    expect(AppointmentReasonPatchSchema.parse({})).toEqual({})
    expect(() => AppointmentReasonPatchSchema.parse({ kind: 'cancel' })).toThrow()
  })
})
