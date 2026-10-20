import { describe, expect, it } from 'vitest'
import { bankDraftDirty, checkBankDraft, emptyBankDraft, endingBalance, endingDifference, linesTotal, type BankStatementDraft } from '../bankDraft'

function draftWith(patch: Partial<BankStatementDraft> = {}): BankStatementDraft {
  const draft = emptyBankDraft('2026-10-01')
  draft.journalId = 3
  draft.lines[0]!.paymentRef = 'تحويل وارد'
  draft.lines[0]!.amount = '150.5'
  return { ...draft, ...patch }
}

describe('the statement draft', () => {
  it('builds the body the contract accepts', () => {
    const draft = draftWith({ name: ' BNK ', balanceStart: '1000', balanceEndReal: '1150.5' })
    draft.lines[0]!.partnerId = 7
    expect(checkBankDraft(draft)).toEqual({
      errors: null,
      body: { journal_id: 3, date: '2026-10-01', name: 'BNK', balance_start: 1000, balance_end_real: 1150.5, lines: [{ date: '2026-10-01', payment_ref: 'تحويل وارد', partner_id: 7, amount: 150.5 }] },
    })
  })

  it('leaves out an empty name, balances and partner', () => {
    const check = checkBankDraft(draftWith())
    expect(check.body).toEqual({ journal_id: 3, date: '2026-10-01', lines: [{ date: '2026-10-01', payment_ref: 'تحويل وارد', amount: 150.5 }] })
  })

  it('reports each refused field by its path', () => {
    const draft = draftWith({ journalId: null, date: null, balanceStart: 'abc' })
    draft.lines[0]!.paymentRef = '  '
    draft.lines[0]!.amount = '0'
    const check = checkBankDraft(draft)
    expect(check.body).toBeNull()
    expect(Object.keys(check.errors ?? {}).sort()).toEqual(['balance_start', 'date', 'journal_id', 'lines.0.amount', 'lines.0.payment_ref'])
  })

  it('refuses an empty amount and a statement without lines', () => {
    const empty = draftWith()
    empty.lines[0]!.amount = ''
    expect(checkBankDraft(empty).errors).toHaveProperty(['lines.0.amount'])
    expect(checkBankDraft(draftWith({ lines: [] })).errors).toHaveProperty('lines')
  })
})

describe('the ending balance', () => {
  it('is the opening balance plus every readable line, to the cent', () => {
    const draft = draftWith({ balanceStart: '100.10' })
    draft.lines.push({ key: 99, date: null, paymentRef: 'x', partnerId: null, amount: '-0.20' }, { key: 100, date: null, paymentRef: 'y', partnerId: null, amount: 'oops' })
    expect(linesTotal(draft)).toBe(150.3)
    expect(endingBalance(draft)).toBe(250.4)
  })

  it('reports a difference only when the bank printed another balance', () => {
    expect(endingDifference(draftWith({ balanceStart: '100' }))).toBeNull()
    expect(endingDifference(draftWith({ balanceStart: '100', balanceEndReal: '250.5' }))).toBeNull()
    expect(endingDifference(draftWith({ balanceStart: '100', balanceEndReal: '300' }))).toBe(49.5)
  })

  it('is not fooled by floating-point sums', () => {
    const draft = draftWith({ balanceStart: '0.1', balanceEndReal: '0.3' })
    draft.lines[0]!.amount = '0.2'
    expect(endingDifference(draft)).toBeNull()
  })
})

describe('the unsaved-changes guard', () => {
  it('ignores the defaults and notices anything typed', () => {
    expect(bankDraftDirty(emptyBankDraft('2026-10-01'))).toBe(false)
    expect(bankDraftDirty(draftWith())).toBe(true)
    expect(bankDraftDirty({ ...emptyBankDraft('2026-10-01'), name: 'BNK' })).toBe(true)
  })
})
