import type { FinanceAssetProfile, FinanceAccount, FinanceJournal, FinancePaymentTerm, FinanceTax } from '@liwan/contracts'
import {
  FinanceAccountCreateSchema,
  FinanceAssetProfileCreateSchema,
  FinanceJournalCreateSchema,
  FinancePaymentTermCreateSchema,
  FinanceTaxCreateSchema,
} from '@liwan/contracts'
import { describe, expect, it } from 'vitest'
import {
  accountCreate, accountDraft, accountPatch, accountValid,
  assetProfileCreate, assetProfileDraft, assetProfilePatch, assetProfileValid,
  journalCreate, journalDraft, journalPatch, journalValid,
  newTermLine, percentTotal, taxCreate, taxDraft, taxPatch, taxValid,
  termCreate, termDraft, termPatch, termValid,
} from '../recordForms'

const ACCOUNT: FinanceAccount = { id: 1, code: '600100', name: 'Rent', account_type: 'expense', reconcile: false, currency: null, active: true }
const JOURNAL: FinanceJournal = { id: 2, name: 'Sales', code: 'SLS', type: 'sale', currency: 'SAR', default_account: null, active: true }
const TAX: FinanceTax = { id: 3, name: 'VAT 15%', type_tax_use: 'sale', amount_type: 'percent', amount: 15, price_include: false, tax_account: { id: 7, name: 'VAT payable' }, active: true, used: false }
const TERM: FinancePaymentTerm = { id: 4, name: 'Net 30', shared: false, active: true, lines: [{ value: 'percent', value_amount: 100, nb_days: 30, delay_type: 'days_after' }] }

describe('the account form', () => {
  it('sends a valid body for a new account and only the changes of an edit', () => {
    const draft = { ...accountDraft(), code: ' 600200 ', name: ' Utilities ', currency: 'sar' }
    expect(accountValid(draft)).toBe(true)
    expect(FinanceAccountCreateSchema.parse(accountCreate(draft))).toEqual({ code: '600200', name: 'Utilities', account_type: 'expense', reconcile: false, currency: 'SAR' })
    expect(accountPatch(ACCOUNT, accountDraft(ACCOUNT))).toBeNull()
    expect(accountPatch(ACCOUNT, { ...accountDraft(ACCOUNT), name: 'Office rent', reconcile: true })).toEqual({ name: 'Office rent', reconcile: true })
    expect(accountPatch(ACCOUNT, { ...accountDraft(ACCOUNT), currency: 'usd' })).toEqual({ currency: 'USD' })
  })

  it('is not valid without a code and a name', () => {
    expect(accountValid(accountDraft())).toBe(false)
    expect(accountValid({ ...accountDraft(), code: '1', name: '  ' })).toBe(false)
  })
})

describe('the journal form', () => {
  it('needs the account of a bank or cash journal and sends it', () => {
    expect(journalValid({ ...journalDraft(), name: 'Main bank', code: 'BNK', type: 'bank' })).toBe(false)
    const draft = { ...journalDraft(), name: 'Main bank', code: 'BNK', type: 'bank' as const, defaultAccountId: 9 }
    expect(journalValid(draft)).toBe(true)
    expect(FinanceJournalCreateSchema.parse(journalCreate(draft))).toMatchObject({ type: 'bank', default_account_id: 9 })
    expect(journalValid({ ...journalDraft(), name: 'Sales 2', code: 'S2' })).toBe(true)
  })

  it('never sends the type of an edited journal', () => {
    expect(journalPatch(JOURNAL, journalDraft(JOURNAL))).toBeNull()
    expect(journalPatch(JOURNAL, { ...journalDraft(JOURNAL), name: 'Branch sales', type: 'purchase' })).toEqual({ name: 'Branch sales' })
  })
})

describe('the tax form', () => {
  it('needs the tax account and a rate', () => {
    expect(taxValid({ ...taxDraft(), name: 'VAT 5%', amount: 5 })).toBe(false)
    const draft = { ...taxDraft(), name: 'VAT 5%', amount: 5, taxAccountId: 7 }
    expect(taxValid(draft)).toBe(true)
    expect(FinanceTaxCreateSchema.parse(taxCreate(draft))).toMatchObject({ type_tax_use: 'sale', amount: 5, tax_account_id: 7 })
  })

  it('lets a used tax change only its name', () => {
    const used = { ...TAX, used: true }
    const draft = { ...taxDraft(used), name: 'VAT standard', amount: 5, priceInclude: true, taxAccountId: 8 }
    expect(taxPatch(used, draft)).toEqual({ name: 'VAT standard' })
    expect(taxPatch(TAX, draft)).toEqual({ name: 'VAT standard', amount: 5, price_include: true, tax_account_id: 8 })
    expect(taxPatch(TAX, taxDraft(TAX))).toBeNull()
  })
})

describe('the payment term form', () => {
  it('starts with one full installment and adds up the percent ones', () => {
    const draft = termDraft()
    expect(percentTotal(draft)).toBe(100)
    draft.lines.push({ ...newTermLine(), amount: 50 })
    expect(percentTotal(draft)).toBe(150)
    expect(termValid({ ...draft, name: 'x' })).toBe(false)
  })

  it('is valid at exactly 100 percent and sends the installments', () => {
    const draft = { ...termDraft(), name: '50/50', lines: [{ ...newTermLine(), amount: 50 }, { ...newTermLine(), amount: 50, days: 30 }] }
    expect(termValid(draft)).toBe(true)
    expect(FinancePaymentTermCreateSchema.parse(termCreate(draft)).lines.map(line => line.nb_days)).toEqual([0, 30])
    expect(termValid({ ...draft, lines: [{ ...newTermLine(), amount: null }] })).toBe(false)
    expect(termValid({ ...draft, name: ' ' })).toBe(false)
  })

  it('sends the lines of an edit only when they changed', () => {
    expect(termPatch(TERM, termDraft(TERM))).toBeNull()
    expect(termPatch(TERM, { ...termDraft(TERM), name: 'Net 45' })).toEqual({ name: 'Net 45' })
    const longer = termDraft(TERM)
    longer.lines[0]!.days = 60
    expect(termPatch(TERM, longer)).toEqual({ lines: [{ value: 'percent', value_amount: 100, nb_days: 60, delay_type: 'days_after' }] })
  })
})

describe('asset profile drafts', () => {
  const profile = {
    id: 3, name: 'Vehicles', method: 'linear', method_time: 'year', method_number: 5, method_period: 'year', prorata: false,
    asset_account: { id: 1, name: 'Vehicles' }, depreciation_account: { id: 2, name: 'Accumulated' }, expense_account: { id: 4, name: 'Expense' },
    journal: { id: 7, name: 'Misc' }, plus_value_account: null, min_value_account: null, active: true,
  } as FinanceAssetProfile

  it('needs a name, the three accounts, a journal and a whole duration', () => {
    expect(assetProfileValid(assetProfileDraft())).toBe(false)
    expect(assetProfileValid(assetProfileDraft(profile))).toBe(true)
    expect(assetProfileValid({ ...assetProfileDraft(profile), methodNumber: 0 })).toBe(false)
    expect(assetProfileValid({ ...assetProfileDraft(profile), methodNumber: 2.5 })).toBe(false)
  })

  it('builds a body the contract accepts and sends only the changes on edit', () => {
    expect(FinanceAssetProfileCreateSchema.parse(assetProfileCreate(assetProfileDraft(profile)))).toMatchObject({ name: 'Vehicles', journal_id: 7, method_number: 5 })
    expect(assetProfilePatch(profile, assetProfileDraft(profile))).toBeNull()
    expect(assetProfilePatch(profile, { ...assetProfileDraft(profile), name: ' Cars ', minAccountId: 9 })).toEqual({ name: 'Cars', min_value_account_id: 9 })
    expect(assetProfilePatch({ ...profile, min_value_account: { id: 9, name: 'Loss' } }, { ...assetProfileDraft(profile), minAccountId: null })).toEqual({ min_value_account_id: null })
  })
})

describe('archive refusals', () => {
  it('words the draft entries of a journal and leaves other codes to the server text', async () => {
    const { archiveErrorKey } = await import('../recordForms')
    expect(archiveErrorKey({ code: 'journal_has_drafts' })).toBe('financeRecords.errors.journal_has_drafts')
    expect(archiveErrorKey({ code: 'invalid' })).toBeNull()
    expect(archiveErrorKey(new Error('offline'))).toBeNull()
  })
})
