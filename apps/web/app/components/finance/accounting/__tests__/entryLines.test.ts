import { describe, expect, it } from 'vitest'
import { JournalEntryCreateSchema, JournalEntryPatchSchema, type JournalEntryDetail } from '@webvue/contracts'
import {
  buildEntryCreate,
  buildEntryPatch,
  emptyEntryDraft,
  entryDraftFromRecord,
  entryBalanced,
  entryDraftDirty,
  entryTotals,
  hasEntryErrors,
  newEntryLine,
  validateEntryDraft,
} from '../entryLines'

function balanced() {
  const draft = emptyEntryDraft()
  draft.journalId = 5
  draft.date = '2026-10-01'
  draft.ref = ' ADJ-1 '
  Object.assign(draft.lines[0]!, { accountId: 11, name: ' Rent ', debit: '100.10' })
  Object.assign(draft.lines[1]!, { accountId: 12, partnerId: 3, name: 'Bank', credit: '100.1' })
  return draft
}

describe('totals', () => {
  it('sums both sides and reports the difference in hundredths', () => {
    expect(entryTotals(balanced().lines)).toEqual({ debit: 100.1, credit: 100.1, difference: 0 })
    expect(entryTotals([{ debit: '0.1', credit: '' }, { debit: '0.2', credit: '0.3' }]).difference).toBe(0)
    expect(entryTotals([{ debit: '10', credit: '' }, { debit: '', credit: '4.5' }]).difference).toBe(5.5)
  })

  it('balances only when both sides are equal and above zero', () => {
    expect(entryBalanced(entryTotals(balanced().lines))).toBe(true)
    expect(entryBalanced(entryTotals([]))).toBe(false)
    expect(entryBalanced(entryTotals([{ debit: '5', credit: '' }]))).toBe(false)
  })

  it('ignores amounts that are not numbers', () => {
    expect(entryTotals([{ debit: 'x', credit: '-3' }])).toEqual({ debit: 0, credit: 0, difference: 0 })
  })
})

describe('validation', () => {
  it('accepts a balanced entry', () => {
    expect(hasEntryErrors(validateEntryDraft(balanced()))).toBe(false)
  })

  it('flags the missing header and every incomplete line', () => {
    const errors = validateEntryDraft(emptyEntryDraft())
    expect(errors).toMatchObject({ journal: true, date: true, tooFewLines: false, unbalanced: true })
    expect(errors.lines[0]).toEqual({ account: true, name: true, amount: true })
    expect(hasEntryErrors(errors)).toBe(true)
  })

  it('needs exactly one of debit and credit above zero', () => {
    const both = balanced()
    both.lines[0]!.credit = '5'
    expect(validateEntryDraft(both).lines[0]).toEqual({ amount: true })
    const negative = balanced()
    negative.lines[1]!.credit = '-100.1'
    expect(validateEntryDraft(negative).lines[1]).toEqual({ amount: true })
  })

  it('flags an unbalanced entry and fewer than two lines', () => {
    const skewed = balanced()
    skewed.lines[1]!.credit = '90'
    expect(validateEntryDraft(skewed).unbalanced).toBe(true)
    const single = balanced()
    single.lines.pop()
    expect(validateEntryDraft(single).tooFewLines).toBe(true)
  })
})

describe('create body', () => {
  it('trims text, sends the filled side and satisfies the contract', () => {
    const body = buildEntryCreate(balanced())
    expect(body).toEqual({
      journal_id: 5,
      date: '2026-10-01',
      ref: 'ADJ-1',
      lines: [
        { account_id: 11, name: 'Rent', debit: 100.1 },
        { account_id: 12, partner_id: 3, name: 'Bank', credit: 100.1 },
      ],
    })
    expect(JournalEntryCreateSchema.safeParse(body).success).toBe(true)
  })

  it('omits an empty reference', () => {
    const draft = balanced()
    draft.ref = ' '
    expect(buildEntryCreate(draft)).not.toHaveProperty('ref')
  })
})

describe('dirty tracking', () => {
  it('ignores line keys and notices edits', () => {
    const a = emptyEntryDraft()
    const b = structuredClone(a)
    b.lines = b.lines.map(() => newEntryLine())
    expect(entryDraftDirty(b, a)).toBe(false)
    b.ref = 'x'
    expect(entryDraftDirty(b, a)).toBe(true)
  })
})

const stored: JournalEntryDetail = {
  id: 7,
  name: null,
  state: 'draft',
  date: '2026-10-01',
  ref: 'ADJ-1',
  journal: { id: 5, name: 'Miscellaneous' },
  currency: 'SAR',
  amount_total: 250,
  lines: [
    { id: 1, account: { id: 11, name: 'Rent' }, partner: null, name: 'Rent', debit: 250, credit: 0, analytic_distribution: [{ account: { id: 40, name: 'Riyadh', code: 'RUH' }, percent: 60 }, { account: { id: 41, name: 'Jeddah', code: 'JED' }, percent: 40 }] },
    { id: 2, account: { id: 12, name: 'Bank' }, partner: { id: 3, name: 'Landlord' }, name: 'Bank', debit: 0, credit: 250, analytic_distribution: [] },
  ],
}

describe('editing a draft', () => {
  it('fills the editor from the record, keeping each line\'s analytic split', () => {
    const draft = entryDraftFromRecord(stored)
    expect(draft).toMatchObject({ journalId: 5, date: '2026-10-01', ref: 'ADJ-1' })
    expect(draft.lines.map(({ key: _key, ...line }) => line)).toEqual([
      { accountId: 11, partnerId: null, name: 'Rent', debit: '250', credit: '', analytic: { 40: 60, 41: 40 } },
      { accountId: 12, partnerId: 3, name: 'Bank', debit: '', credit: '250', analytic: null },
    ])
    expect(hasEntryErrors(validateEntryDraft(draft))).toBe(false)
    expect(entryDraftDirty(entryDraftFromRecord(stored), draft)).toBe(false)
  })

  it('sends the header alone while the lines are untouched', () => {
    const initial = entryDraftFromRecord(stored)
    const draft = structuredClone(initial)
    draft.ref = ' '
    draft.date = '2026-10-05'
    const body = buildEntryPatch(draft, initial)
    expect(body).toEqual({ journal_id: 5, date: '2026-10-05', ref: '' })
    expect(JournalEntryPatchSchema.safeParse(body).success).toBe(true)
  })

  it('replaces every line, analytic split included, once a line changed', () => {
    const initial = entryDraftFromRecord(stored)
    const draft = structuredClone(initial)
    draft.lines[0]!.debit = '300'
    draft.lines[1]!.credit = '300'
    const body = buildEntryPatch(draft, initial)
    expect(body.lines).toEqual([
      { account_id: 11, name: 'Rent', debit: 300, analytic_distribution: { 40: 60, 41: 40 } },
      { account_id: 12, partner_id: 3, name: 'Bank', credit: 300 },
    ])
    expect(JournalEntryPatchSchema.safeParse(body).success).toBe(true)
  })
})
