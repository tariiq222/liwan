import { AppointmentsRecordListSchema, AppointmentsRecordSchema } from '../index'

const RECORD = { id: 1, name: 'First record' }

describe('AppointmentsRecordSchema', () => {
  it('is strict: it accepts exactly id and name', () => {
    expect(AppointmentsRecordSchema.parse(RECORD)).toEqual(RECORD)
    expect(Object.keys(AppointmentsRecordSchema.shape).sort()).toEqual(['id', 'name'])
    expect(() => AppointmentsRecordSchema.parse({ ...RECORD, secret: 'x' })).toThrow()
  })

  it('rejects a missing name and a non-positive id', () => {
    expect(() => AppointmentsRecordSchema.parse({ id: 1 })).toThrow()
    expect(() => AppointmentsRecordSchema.parse({ ...RECORD, id: 0 })).toThrow()
  })
})

describe('AppointmentsRecordListSchema', () => {
  it('wraps records with a total and rejects extra keys', () => {
    expect(AppointmentsRecordListSchema.parse({ items: [RECORD], total: 1 })).toEqual({ items: [RECORD], total: 1 })
    expect(() => AppointmentsRecordListSchema.parse({ items: [RECORD], total: 1, next: 2 })).toThrow()
    expect(() => AppointmentsRecordListSchema.parse({ items: [RECORD], total: -1 })).toThrow()
  })
})
