import { describe, expect, it } from 'vitest'
import { JournalEntryCreateSchema } from '@webvue/contracts'
import {
  buildEntryCreate,
  emptyEntryDraft,
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
