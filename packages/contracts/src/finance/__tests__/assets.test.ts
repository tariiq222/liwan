import {
  FinanceAssetComputeInputSchema,
  FinanceAssetComputeResultSchema,
  FinanceAssetCreateSchema,
  FinanceAssetDetailSchema,
  FinanceAssetListSchema,
  FinanceAssetProfileListSchema,
} from '..'

const REF = { id: 4, name: 'Furniture' }
const ASSET = {
  id: 3,
  name: 'Meeting table',
  code: 'FUR-1',
  state: 'open',
  profile: REF,
  partner: null,
  date_start: '2026-01-01',
  currency: 'SAR',
  purchase_value: 12000,
  salvage_value: 0,
  depreciation_base: 12000,
  value_depreciated: 2400,
  value_residual: 9600,
}
const LINE = {
  id: 8, type: 'depreciate', date: '2026-12-31', amount: 2400, depreciated_value: 0, remaining_value: 9600,
  posted: true, entry: { id: 70, name: 'TA/2026/12/0001' },
}
const PROFILE = {
  id: 4, name: 'Furniture 5 years', method: 'linear', method_time: 'year', method_number: 5, method_period: 'year',
  prorata: false, asset_account: REF, depreciation_account: REF, expense_account: REF, journal: REF,
}

describe('finance asset schemas', () => {
  it('parse the list, the profiles and the detail with its board, and are strict', () => {
    expect(FinanceAssetListSchema.parse({ items: [ASSET], total: 1 })).toEqual({ items: [ASSET], total: 1 })
    expect(FinanceAssetProfileListSchema.parse({ items: [PROFILE], total: 1 })).toEqual({ items: [PROFILE], total: 1 })
    const detail = {
      ...ASSET, note: '', method: 'linear', method_time: 'year', method_number: 5, method_period: 'year', prorata: false,
      lines: [LINE, { ...LINE, id: 9, type: 'create', posted: false, entry: null }],
    }
    expect(FinanceAssetDetailSchema.parse(detail)).toEqual(detail)
    expect(() => FinanceAssetDetailSchema.parse({ ...detail, state: 'lost' })).toThrow()
    expect(() => FinanceAssetDetailSchema.parse({ ...detail, lines: [{ ...LINE, type: 'sell' }] })).toThrow()
    expect(() => FinanceAssetListSchema.parse({ items: [{ ...ASSET, secret: 1 }], total: 1 })).toThrow()
  })

  it('accept a create body and reject an unknown key, a zero value and a bad date', () => {
    const body = { profile_id: 4, name: 'Table', purchase_value: 12000, date_start: '2026-01-01' }
    expect(FinanceAssetCreateSchema.parse({ ...body, code: 'T-1', salvage_value: 0, partner_id: null, note: 'x' }))
      .toEqual({ ...body, code: 'T-1', salvage_value: 0, partner_id: null, note: 'x' })
    expect(() => FinanceAssetCreateSchema.parse({ ...body, state: 'open' })).toThrow()
    expect(() => FinanceAssetCreateSchema.parse({ ...body, purchase_value: 0 })).toThrow()
    expect(() => FinanceAssetCreateSchema.parse({ ...body, purchase_value: '12000' })).toThrow()
    expect(() => FinanceAssetCreateSchema.parse({ ...body, date_start: '01/01/2026' })).toThrow()
    expect(() => FinanceAssetCreateSchema.parse({ ...body, code: 'x'.repeat(33) })).toThrow()
    expect(() => FinanceAssetCreateSchema.parse({ profile_id: 4, name: 'Table' })).toThrow()
  })

  it('parse the depreciation run', () => {
    expect(FinanceAssetComputeInputSchema.parse({ date: '2026-12-31' })).toEqual({ date: '2026-12-31' })
    expect(() => FinanceAssetComputeInputSchema.parse({})).toThrow()
    expect(FinanceAssetComputeResultSchema.parse({ date: '2026-12-31', entries: [REF] }))
      .toEqual({ date: '2026-12-31', entries: [REF] })
  })
})
