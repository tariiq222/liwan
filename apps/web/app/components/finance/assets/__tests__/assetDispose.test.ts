import { describe, expect, it } from 'vitest'
import { FinanceAssetDisposeSchema } from '@webvue/contracts'
import { buildDispose, emptyDisposeDraft, isSale, validateDispose } from '../assetDispose'

describe('asset disposal draft', () => {
  it('scraps with no proceeds and needs only the date', () => {
    const draft = emptyDisposeDraft('2026-05-31')
    expect(isSale(draft)).toBe(false)
    expect(validateDispose(draft)).toEqual({})
    expect(buildDispose(draft)).toEqual({ date_remove: '2026-05-31' })
  })

  it('asks for the proceeds account once there are proceeds', () => {
    const draft = { ...emptyDisposeDraft('2026-05-31'), saleValue: '4000' }
    expect(validateDispose(draft)).toEqual({ saleAccountId: 'required' })
    const body = buildDispose({ ...draft, saleAccountId: 9, minAccountId: 12, note: ' sold ' })
    expect(FinanceAssetDisposeSchema.parse(body)).toEqual({ date_remove: '2026-05-31', sale_value: 4000, sale_account_id: 9, min_account_id: 12, note: 'sold' })
  })

  it('refuses a negative or unreadable amount and a missing date', () => {
    expect(validateDispose({ ...emptyDisposeDraft('2026-05-31'), saleValue: '-5' })).toEqual({ saleValue: 'invalid' })
    expect(validateDispose({ ...emptyDisposeDraft('2026-05-31'), saleValue: 'abc' })).toEqual({ saleValue: 'invalid' })
    expect(validateDispose({ ...emptyDisposeDraft('2026-05-31'), date: null })).toEqual({ date: 'required' })
  })
})
