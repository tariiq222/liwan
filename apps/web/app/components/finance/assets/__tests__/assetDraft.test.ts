import { describe, expect, it } from 'vitest'
import { FinanceAssetCreateSchema } from '@webvue/contracts'
import { assetDraftDirty, buildAssetCreate, emptyAssetDraft, hasAssetErrors, validateAssetDraft } from '../assetDraft'

function valid() {
  return { ...emptyAssetDraft('2026-10-20'), profileId: 2, name: ' Laptops ', code: ' AST-1 ', purchaseValue: '12000.50', salvageValue: '500', partnerId: 3, note: ' new ' }
}

describe('asset form validation', () => {
  it('starts on the given day and asks for the profile, the name and the purchase value', () => {
    const errors = validateAssetDraft(emptyAssetDraft('2026-10-20'))
    expect(errors).toEqual({ profile: true, name: true, purchaseValue: true })
  })

  it('accepts a filled form and a blank salvage value', () => {
    expect(hasAssetErrors(validateAssetDraft(valid()))).toBe(false)
    expect(hasAssetErrors(validateAssetDraft({ ...valid(), salvageValue: '' }))).toBe(false)
  })

  it('refuses a purchase value of zero, a negative salvage value, a long code and a cleared date', () => {
    expect(validateAssetDraft({ ...valid(), purchaseValue: '0' })).toEqual({ purchaseValue: true })
    expect(validateAssetDraft({ ...valid(), salvageValue: '-1' })).toEqual({ salvageValue: true })
    expect(validateAssetDraft({ ...valid(), code: 'x'.repeat(33) })).toEqual({ code: true })
    expect(validateAssetDraft({ ...valid(), dateStart: null })).toEqual({ dateStart: true })
  })
})

describe('asset form payload', () => {
  it('builds a payload the contract accepts, trimmed', () => {
    const payload = buildAssetCreate(valid())
    expect(payload).toEqual({ profile_id: 2, name: 'Laptops', code: 'AST-1', purchase_value: 12000.5, salvage_value: 500, date_start: '2026-10-20', partner_id: 3, note: 'new' })
    expect(FinanceAssetCreateSchema.safeParse(payload).success).toBe(true)
  })

  it('leaves out what was not typed', () => {
    const payload = buildAssetCreate({ ...valid(), code: '', salvageValue: '', partnerId: null, note: ' ' })
    expect(payload).toEqual({ profile_id: 2, name: 'Laptops', purchase_value: 12000.5, date_start: '2026-10-20' })
  })

  it('tells a changed draft from the baseline', () => {
    const baseline = emptyAssetDraft('2026-10-20')
    expect(assetDraftDirty({ ...baseline }, baseline)).toBe(false)
    expect(assetDraftDirty({ ...baseline, name: 'x' }, baseline)).toBe(true)
  })
})
