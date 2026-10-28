import { AppointmentTypeListSchema, AppointmentTypeSchema } from '../index'

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
