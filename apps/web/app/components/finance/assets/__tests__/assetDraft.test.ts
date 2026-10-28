import { describe, expect, it } from 'vitest'
import { FinanceAssetUpdateSchema, FinanceAssetCreateSchema, type FinanceAssetDetail } from '@webvue/contracts'
import { assetDraftDirty, assetDraftFromRecord, buildAssetCreate, buildAssetUpdate, emptyAssetDraft, hasAssetErrors, validateAssetDraft } from '../assetDraft'

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

const stored: FinanceAssetDetail = {
  id: 7, name: 'Table', code: 'FUR-1', state: 'draft', profile: { id: 2, name: 'Furniture' }, partner: { id: 3, name: 'Vendor' },
  date_start: '2026-01-01', currency: 'SAR', purchase_value: 12000, salvage_value: 0, depreciation_base: 12000, value_depreciated: 0,
  value_residual: 12000, note: 'Boardroom', date_remove: null, method: 'linear', method_time: 'year', method_number: 5, method_period: 'year',
  prorata: false, lines: [], allowed_actions: ['edit'], blocked_actions: [],
}

describe('editing a draft asset', () => {
  it('fills the form from the record, a salvage value of zero blank', () => {
    expect(assetDraftFromRecord(stored)).toEqual({
      profileId: 2, name: 'Table', code: 'FUR-1', purchaseValue: '12000', salvageValue: '', dateStart: '2026-01-01', partnerId: 3, note: 'Boardroom',
    })
    expect(assetDraftFromRecord({ ...stored, salvage_value: 500.5 }).salvageValue).toBe('500.5')
    expect(hasAssetErrors(validateAssetDraft(assetDraftFromRecord(stored)))).toBe(false)
  })

  it('sends nothing for an untouched form and only what changed otherwise', () => {
    const initial = assetDraftFromRecord(stored)
    expect(buildAssetUpdate(structuredClone(initial), initial)).toEqual({})
    const body = buildAssetUpdate({ ...initial, name: ' Desk ', purchaseValue: '9000', dateStart: '2026-03-01' }, initial)
    expect(body).toEqual({ name: 'Desk', purchase_value: 9000, date_start: '2026-03-01' })
    expect(FinanceAssetUpdateSchema.safeParse(body).success).toBe(true)
  })

  it('clears an emptied code, note, partner and salvage value instead of leaving them out', () => {
    const initial = assetDraftFromRecord({ ...stored, salvage_value: 500 })
    const body = buildAssetUpdate({ ...initial, code: '', note: ' ', partnerId: null, salvageValue: '' }, initial)
    expect(body).toEqual({ code: '', note: '', partner_id: null, salvage_value: 0 })
    expect(FinanceAssetUpdateSchema.safeParse(body).success).toBe(true)
  })

  it('moves to another profile only when it was chosen', () => {
    const initial = assetDraftFromRecord(stored)
    expect(buildAssetUpdate({ ...initial, profileId: 4 }, initial)).toEqual({ profile_id: 4 })
  })
})
