import { describe, expect, it } from 'vitest'
import { CompanyTaxPatchSchema, CompanyTaxSchema } from '../companyTax'

const TAX = {
  registered: true,
  price_mode: 'included',
  choice: 'included',
  locked: false,
  can_change: true,
  is_root_session: true,
}

describe('CompanyTaxSchema', () => {
  it('accepts the serializer shape and refuses a stray key', () => {
    expect(CompanyTaxSchema.parse(TAX)).toEqual(TAX)
    expect(CompanyTaxSchema.safeParse({ ...TAX, extra: 1 }).success).toBe(false)
    expect(CompanyTaxSchema.safeParse({ ...TAX, choice: 'tax_included' }).success).toBe(false)
    expect(CompanyTaxSchema.safeParse({ ...TAX, registered: 'yes' }).success).toBe(false)
  })

  it('accepts an unregistered establishment that keeps its price mode', () => {
    const body = { ...TAX, registered: false, choice: 'none' }
    expect(CompanyTaxSchema.parse(body)).toEqual(body)
  })
})

describe('CompanyTaxPatchSchema', () => {
  it('accepts either field alone or both', () => {
    expect(CompanyTaxPatchSchema.parse({ price_mode: 'added' })).toEqual({ price_mode: 'added' })
    expect(CompanyTaxPatchSchema.parse({ registered: false })).toEqual({ registered: false })
    expect(CompanyTaxPatchSchema.parse({ registered: true, price_mode: 'included' })).toBeTruthy()
  })

  it('refuses an unknown key and an unknown price mode', () => {
    expect(CompanyTaxPatchSchema.safeParse({ mode: 'added' }).success).toBe(false)
    expect(CompanyTaxPatchSchema.safeParse({ price_mode: 'maybe' }).success).toBe(false)
    expect(CompanyTaxPatchSchema.safeParse({ registered: true, extra: 1 }).success).toBe(false)
  })

  it('refuses an empty body, as the route answers 422 for it', () => {
    expect(CompanyTaxPatchSchema.safeParse({}).success).toBe(false)
  })
})
