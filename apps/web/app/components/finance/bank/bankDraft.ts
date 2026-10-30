import { FinanceBankStatementCreateSchema, type FinanceBankStatementCreate } from '@liwan/contracts'
import { roundMoney } from './bankModel'

/** The most lines one statement can carry (the contract's limit). */
export const MAX_STATEMENT_LINES = 500

/** One line of the editor as typed: the amount stays a string until it is validated. */
export interface BankLineDraft {
  key: number
  date: string | null
  paymentRef: string
  partnerId: number | null
  amount: string
}

export interface BankStatementDraft {
  journalId: number | null
  date: string | null
  name: string
  balanceStart: string
  balanceEndReal: string
  lines: BankLineDraft[]
}

let nextKey = 1
export function newBankLine(date: string | null): BankLineDraft {
  return { key: nextKey++, date, paymentRef: '', partnerId: null, amount: '' }
}

export function emptyBankDraft(today: string): BankStatementDraft {
  return { journalId: null, date: today, name: '', balanceStart: '', balanceEndReal: '', lines: [newBankLine(today)] }
}

/** A typed number; an empty or unreadable box is NaN so the contract refuses it. */
const typed = (value: string) => value.trim() === '' ? Number.NaN : Number(value)
const optionalNumber = (value: string) => value.trim() === '' ? {} : { value: Number(value) }

/** The request body as typed; the contract decides whether it is acceptable. */
function statementInput(draft: BankStatementDraft) {
  const name = draft.name.trim()
  const start = optionalNumber(draft.balanceStart)
  const end = optionalNumber(draft.balanceEndReal)
  return {
    journal_id: draft.journalId,
    date: draft.date,
    ...(name ? { name } : {}),
    ...('value' in start ? { balance_start: start.value } : {}),
    ...('value' in end ? { balance_end_real: end.value } : {}),
    lines: draft.lines.map(line => ({
      date: line.date,
      payment_ref: line.paymentRef.trim(),
      ...(line.partnerId ? { partner_id: line.partnerId } : {}),
      amount: typed(line.amount),
    })),
  }
}

/** Fields the contract refuses, keyed by their path in the body: `journal_id`, `lines.2.amount`, ... */
export type BankDraftErrors = Record<string, true>

export type BankDraftCheck = { body: FinanceBankStatementCreate; errors: null } | { body: null; errors: BankDraftErrors }

export function checkBankDraft(draft: BankStatementDraft): BankDraftCheck {
  const parsed = FinanceBankStatementCreateSchema.safeParse(statementInput(draft))
  if (parsed.success) return { body: parsed.data, errors: null }
  return { body: null, errors: Object.fromEntries(parsed.error.issues.map(issue => [issue.path.join('.'), true as const])) }
}

/** The sum of the lines whose amount is a readable number. */
export function linesTotal(draft: Pick<BankStatementDraft, 'lines'>): number {
  return roundMoney(draft.lines.reduce((sum, line) => sum + (Number.isFinite(typed(line.amount)) ? typed(line.amount) : 0), 0))
}

/** Opening balance plus every line: what the statement should end at. */
export function endingBalance(draft: Pick<BankStatementDraft, 'balanceStart' | 'lines'>): number {
  const start = Number(draft.balanceStart)
  return roundMoney((Number.isFinite(start) ? start : 0) + linesTotal(draft))
}

/** The ending balance the bank printed, when given and different from the computed one. */
export function endingDifference(draft: BankStatementDraft): number | null {
  if (draft.balanceEndReal.trim() === '' || !Number.isFinite(Number(draft.balanceEndReal))) return null
  const difference = roundMoney(Number(draft.balanceEndReal) - endingBalance(draft))
  return difference === 0 ? null : difference
}

/** Anything typed beyond the defaults: leaving the panel then asks first. */
export function bankDraftDirty(draft: BankStatementDraft): boolean {
  return !!draft.name.trim() || !!draft.balanceStart.trim() || !!draft.balanceEndReal.trim()
    || draft.lines.some(line => !!line.paymentRef.trim() || !!line.amount.trim() || !!line.partnerId)
}
