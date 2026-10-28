import {
  FinanceDebitNoteCreateSchema,
  JournalEntryCreateSchema,
  JournalEntryDetailSchema,
  JournalEntryListSchema,
  JournalEntryPatchSchema,
} from '..'

const DEBIT = { account_id: 4, name: 'Rent', debit: 500 }
const CREDIT = { account_id: 9, partner_id: 7, name: 'Rent', credit: 500 }
const ENTRY = { journal_id: 3, date: '2026-10-18', ref: 'ADJ-1', lines: [DEBIT, CREDIT] }
const SUMMARY = {
  id: 1, name: 'MISC/2026/10/0001', state: 'posted', date: '2026-10-18', ref: 'ADJ-1',
  journal: { id: 3, name: 'Miscellaneous Operations' }, currency: 'SAR', amount_total: 500,
}
const DETAIL = {
  ...SUMMARY,
  lines: [
    { id: 1, account: { id: 4, name: '600 Rent' }, partner: null, name: 'Rent', debit: 500, credit: 0, analytic_distribution: [] },
    { id: 2, account: { id: 9, name: '200 Payable' }, partner: { id: 7, name: 'Al Noor' }, name: 'Rent', debit: 0, credit: 500, analytic_distribution: [] },
  ],
  allowed_actions: ['reset_to_draft'],
  blocked_actions: [{ action: 'unreconcile', reason: 'period_locked' }],
}

describe('finance journal entry schemas', () => {
  it('parse the exact response shapes and the list envelope, and are strict', () => {
    expect(JournalEntryDetailSchema.parse(DETAIL)).toEqual(DETAIL)
    expect(JournalEntryListSchema.parse({ items: [SUMMARY], total: 1 })).toEqual({ items: [SUMMARY], total: 1 })
    expect(() => JournalEntryDetailSchema.parse({ ...DETAIL, extra: 1 })).toThrow()
    expect(() => JournalEntryListSchema.parse({ items: [{ ...SUMMARY, state: 'sent' }], total: 1 })).toThrow()
  })

  it('accept a create body and reject an unknown key, a string amount and fewer than two lines', () => {
    expect(JournalEntryCreateSchema.parse(ENTRY)).toEqual(ENTRY)
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, move_type: 'entry' })).toThrow()
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, lines: [{ ...DEBIT, debit: '500' }, CREDIT] })).toThrow()
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, lines: [DEBIT] })).toThrow()
    expect(() => JournalEntryCreateSchema.parse({ journal_id: 3, date: '2026-10-18' })).toThrow()
  })

  it('a line carries exactly one of debit or credit above zero', () => {
    const both = { ...DEBIT, credit: 5 }
    const none = { account_id: 4, name: 'Rent' }
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, lines: [both, CREDIT] })).toThrow()
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, lines: [none, CREDIT] })).toThrow()
    expect(() => JournalEntryCreateSchema.parse({ ...ENTRY, lines: [{ ...DEBIT, debit: -1 }, CREDIT] })).toThrow()
  })

  it('a patch needs at least one known field', () => {
    expect(JournalEntryPatchSchema.parse({ ref: 'ADJ-2' })).toEqual({ ref: 'ADJ-2' })
    expect(() => JournalEntryPatchSchema.parse({})).toThrow()
    expect(() => JournalEntryPatchSchema.parse({ state: 'posted' })).toThrow()
  })
})

describe('finance debit note schema', () => {
  it('a debit note body is optional keys only and strict', () => {
    expect(FinanceDebitNoteCreateSchema.parse({})).toEqual({})
    expect(FinanceDebitNoteCreateSchema.parse({ reason: 'Late fee', date: '2026-10-19', copy_lines: true }))
      .toEqual({ reason: 'Late fee', date: '2026-10-19', copy_lines: true })
    expect(() => FinanceDebitNoteCreateSchema.parse({ copy_lines: 'yes' })).toThrow()
    expect(() => FinanceDebitNoteCreateSchema.parse({ journal_id: 1 })).toThrow()
  })
})
