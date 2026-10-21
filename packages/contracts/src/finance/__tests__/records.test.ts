import { describe, expect, it } from 'vitest'
import {
  FinanceAccountCreateSchema,
  FinanceAccountPatchSchema,
  FinanceJournalCreateSchema,
  FinanceJournalPatchSchema,
  FinancePaymentTermCreateSchema,
  FinancePaymentTermPatchSchema,
  FinanceTaxCreateSchema,
  FinanceTaxPatchSchema,
} from '..'

describe('setup record bodies', () => {
  it('accepts an account, a patch and refuses unknown keys and an empty patch', () => {
    const body = { code: '600100', name: 'Rent', account_type: 'expense' }
    expect(FinanceAccountCreateSchema.parse(body)).toEqual(body)
    expect(FinanceAccountPatchSchema.parse({ name: 'Office rent' })).toEqual({ name: 'Office rent' })
    expect(() => FinanceAccountCreateSchema.parse({ ...body, company_ids: [1] })).toThrow()
    expect(() => FinanceAccountCreateSchema.parse({ ...body, account_type: 'other' })).toThrow()
    expect(() => FinanceAccountPatchSchema.parse({})).toThrow()
  })

  it('needs a default account for a bank or cash journal and never changes the type', () => {
    expect(FinanceJournalCreateSchema.parse({ name: 'Sales', code: 'SLS', type: 'sale' })).toEqual({ name: 'Sales', code: 'SLS', type: 'sale' })
    expect(() => FinanceJournalCreateSchema.parse({ name: 'Cash', code: 'CSH', type: 'cash' })).toThrow()
    expect(FinanceJournalCreateSchema.parse({ name: 'Cash', code: 'CSH', type: 'cash', default_account_id: 4 }).default_account_id).toBe(4)
    expect(() => FinanceJournalPatchSchema.parse({ type: 'bank' })).toThrow()
    expect(() => FinanceJournalPatchSchema.parse({})).toThrow()
  })

  it('requires the tax account of a tax', () => {
    const body = { name: 'VAT 15%', type_tax_use: 'sale', amount: 15, tax_account_id: 7 }
    expect(FinanceTaxCreateSchema.parse(body)).toEqual(body)
    expect(() => FinanceTaxCreateSchema.parse({ name: 'x', type_tax_use: 'sale', amount: 15 })).toThrow()
    expect(() => FinanceTaxCreateSchema.parse({ ...body, type_tax_use: 'none' })).toThrow()
    expect(FinanceTaxPatchSchema.parse({ name: 'VAT' })).toEqual({ name: 'VAT' })
  })

  it('needs percent lines that add up to 100', () => {
    const half = [{ value: 'percent', value_amount: 50, nb_days: 0 }, { value: 'percent', value_amount: 50, nb_days: 30 }]
    expect(FinancePaymentTermCreateSchema.parse({ name: '50/50', lines: half }).lines).toHaveLength(2)
    expect(() => FinancePaymentTermCreateSchema.parse({ name: 'x', lines: [half[0]] })).toThrow()
    expect(() => FinancePaymentTermCreateSchema.parse({ name: 'x', lines: [] })).toThrow()
    expect(FinancePaymentTermPatchSchema.parse({ lines: half }).lines).toHaveLength(2)
    expect(() => FinancePaymentTermPatchSchema.parse({})).toThrow()
  })
})
