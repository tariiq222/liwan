import { describe, expect, it } from 'vitest'
import { FinancePartnerBankCreateSchema, FinancePartnerBankListSchema, FinancePartnerBankPatchSchema } from '..'

const ACCOUNT = { id: 4, acc_number: 'SA0380000000608010167519', holder_name: 'Gulf Supplies', bank_name: 'Al Rajhi Bank', bic: 'RJHISARI', active: true }

describe('partner bank account contracts', () => {
  it('parses a list and refuses an extra key', () => {
    expect(FinancePartnerBankListSchema.parse({ items: [ACCOUNT], total: 1 }).items).toHaveLength(1)
    expect(FinancePartnerBankListSchema.safeParse({ items: [{ ...ACCOUNT, iban: 'x' }], total: 1 }).success).toBe(false)
  })

  it('needs an account number to create and one field to patch', () => {
    expect(FinancePartnerBankCreateSchema.parse({ acc_number: ' SA03 ' }).acc_number).toBe('SA03')
    expect(FinancePartnerBankCreateSchema.safeParse({ holder_name: 'x' }).success).toBe(false)
    expect(FinancePartnerBankPatchSchema.safeParse({}).success).toBe(false)
    expect(FinancePartnerBankPatchSchema.parse({ holder_name: 'New' })).toEqual({ holder_name: 'New' })
  })
})

describe('internal transfer contract', () => {
  it('needs two journals, an amount and a date', async () => {
    const { FinancePaymentTransferSchema } = await import('..')
    const body = { from_journal_id: 1, to_journal_id: 2, amount: 500, payment_date: '2026-10-20' }
    expect(FinancePaymentTransferSchema.parse(body)).toEqual(body)
    expect(FinancePaymentTransferSchema.safeParse({ ...body, amount: 0 }).success).toBe(false)
    expect(FinancePaymentTransferSchema.safeParse({ from_journal_id: 1, amount: 5, payment_date: '2026-10-20' }).success).toBe(false)
  })
})
