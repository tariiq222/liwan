import { describe, expect, it } from 'vitest'
import { CompanyTaxPatchSchema, type CompanyTax } from '@liwan/contracts'
import { chooseOption, chosenOption, optionLocked, taxDraft, taxErrorKey, taxUpdate } from '../companyTax'

const TAX: CompanyTax = { registered: true, price_mode: 'included', choice: 'included', locked: false, can_change: true, is_root_session: true }
const LOCKED: CompanyTax = { ...TAX, locked: true }
const UNREGISTERED: CompanyTax = { ...TAX, registered: false, choice: 'none' }

describe('the tax draft', () => {
  it('starts from the saved answer, folding "not registered" into the none option', () => {
    expect(taxDraft(TAX)).toEqual({ registered: true, priceMode: 'included' })
    expect(taxDraft(UNREGISTERED)).toEqual({ registered: false, priceMode: 'included' })
    expect(chosenOption(taxDraft(TAX))).toBe('included')
    expect(chosenOption(taxDraft(UNREGISTERED))).toBe('none')
  })

  it('keeps the price mode when the establishment picks "no tax", so a later registration uses it', () => {
    expect(chooseOption({ registered: true, priceMode: 'added' }, 'none')).toEqual({ registered: false, priceMode: 'added' })
    expect(chooseOption({ registered: false, priceMode: 'added' }, 'included')).toEqual({ registered: true, priceMode: 'included' })
  })
})

describe('optionLocked', () => {
  it('locks only a price mode change once the establishment has a journal item', () => {
    expect(optionLocked(LOCKED, 'added')).toBe(true)
    expect(optionLocked(LOCKED, 'included')).toBe(false)
    expect(optionLocked(LOCKED, 'none')).toBe(false)
    expect(optionLocked(TAX, 'added')).toBe(false)
  })
})

describe('taxUpdate', () => {
  it('sends only what changed, and nothing for an unchanged draft', () => {
    expect(taxUpdate(TAX, taxDraft(TAX))).toBeNull()
    expect(taxUpdate(TAX, { registered: false, priceMode: 'included' })).toEqual({ registered: false })
    expect(taxUpdate(TAX, { registered: true, priceMode: 'added' })).toEqual({ price_mode: 'added' })
    expect(taxUpdate(UNREGISTERED, { registered: true, priceMode: 'included' })).toEqual({ registered: true })
  })

  it('builds a body the contract accepts', () => {
    expect(CompanyTaxPatchSchema.safeParse(taxUpdate(UNREGISTERED, { registered: true, priceMode: 'added' })).success).toBe(true)
  })
})

describe('taxErrorKey', () => {
  it('names the owning locale message of each refusal the route answers', () => {
    expect(taxErrorKey({ status: 409, code: 'tax_mode_locked' })).toBe('settings.company.tax.errors.locked')
    expect(taxErrorKey({ status: 403, code: 'forbidden' })).toBe('settings.company.tax.errors.forbidden')
    expect(taxErrorKey({ status: 422, code: 'invalid_vat' })).toBe('settings.company.tax.errors.invalidVat')
    expect(taxErrorKey({ status: 422, code: 'vat_check_unavailable' })).toBe('settings.company.tax.errors.vatUnchecked')
    expect(taxErrorKey({ status: 422, code: 'invalid' })).toBe('settings.company.tax.errors.invalid')
    expect(taxErrorKey(new Error('offline'))).toBeNull()
    expect(taxErrorKey(null)).toBeNull()
  })

  it('leaves every other 403 to the shared message, so a plan or read-only reason is not rewritten', () => {
    for (const code of ['tenant_read_only', 'user_read_only', 'branch_read_only', 'feature_not_included']) {
      expect(taxErrorKey({ status: 403, code })).toBeNull()
    }
    // A 403 with no code of its own still has no tax-specific meaning.
    expect(taxErrorKey({ status: 403 })).toBeNull()
  })
})
