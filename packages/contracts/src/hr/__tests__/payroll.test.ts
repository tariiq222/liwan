import { describe, expect, it } from 'vitest'
import { HrCompensationSchema, HrCompensationWriteSchema } from '..'

const COMPENSATION = {
  employee: { id: 3, name: 'ليلى الحربي' },
  basic_wage: 8000,
  housing_allowance: 2000,
  transport_allowance: 500,
  other_allowance: 0,
  fixed_wage: 10500,
  iban: 'SA0380000000608010167519',
  bank: { id: 4, name: 'الراجحي' },
  gosi_number: '123456789',
  gosi_registration_date: '2024-01-01',
  nationality: { id: 186, name: 'السعودية', code: 'SA' },
}

const WRITE = {
  basic_wage: 8000,
  housing_allowance: 2000,
  transport_allowance: 500,
  other_allowance: 0,
  iban: 'SA0380000000608010167519',
  bank_id: 4,
  gosi_number: '123456789',
  gosi_registration_date: '2024-01-01',
}

describe('HrCompensationSchema', () => {
  it('accepts the compensation detail', () => {
    expect(HrCompensationSchema.parse(COMPENSATION)).toEqual(COMPENSATION)
    expect(HrCompensationSchema.parse({ ...COMPENSATION, iban: null, bank: null, gosi_number: null, gosi_registration_date: null, nationality: null })).toBeTruthy()
  })

  it('rejects an unknown key', () => {
    expect(HrCompensationSchema.safeParse({ ...COMPENSATION, salary: 1 }).success).toBe(false)
  })
})

describe('HrCompensationWriteSchema', () => {
  it('accepts a full write and nullable bank fields', () => {
    expect(HrCompensationWriteSchema.parse(WRITE)).toEqual(WRITE)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: null, bank_id: null, gosi_number: null, gosi_registration_date: null }).success).toBe(true)
  })

  it('rejects a non-Saudi IBAN', () => {
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: 'GB29NWBK60161331926819' }).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, iban: 'SA03 8000' }).success).toBe(false)
  })

  it('requires a positive basic wage and non-negative allowances', () => {
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, basic_wage: 0 }).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, housing_allowance: -1 }).success).toBe(false)
  })

  it('rejects a missing or unknown key', () => {
    const { basic_wage: _omit, ...rest } = WRITE
    expect(HrCompensationWriteSchema.safeParse(rest).success).toBe(false)
    expect(HrCompensationWriteSchema.safeParse({ ...WRITE, fixed_wage: 1 }).success).toBe(false)
  })
})
