import type { JournalEntryCreate, JournalEntryLineInput } from '@webvue/contracts'

/** One line of the editor as typed: amounts stay strings until they are validated. */
export interface EntryLineDraft {
  key: number
  accountId: number | null
  partnerId: number | null
  name: string
  debit: string
  credit: string
}

export interface EntryFormDraft {
  journalId: number | null
  date: string | null
  ref: string
  lines: EntryLineDraft[]
}

export type EntryLineField = 'account' | 'name' | 'amount'
export interface EntryFormErrors {
  journal: boolean
  date: boolean
  tooFewLines: boolean
  unbalanced: boolean
  lines: Array<Partial<Record<EntryLineField, true>>>
}

export interface EntryTotals { debit: number; credit: number; difference: number }

const MIN_LINES = 2
/** Amounts are compared in hundredths, so typed decimals never fail a balance by floating-point dust. */
const cents = (value: number) => Math.round(value * 100)

let nextKey = 1
export function newEntryLine(): EntryLineDraft {
  return { key: nextKey++, accountId: null, partnerId: null, name: '', debit: '', credit: '' }
}

export function emptyEntryDraft(): EntryFormDraft {
  return { journalId: null, date: null, ref: '', lines: Array.from({ length: MIN_LINES }, newEntryLine) }
}

/** A typed amount: empty is zero, anything that is not a non-negative number is NaN. */
function amount(value: string): number {
  if (value.trim() === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
}

export function entryTotals(lines: readonly Pick<EntryLineDraft, 'debit' | 'credit'>[]): EntryTotals {
  const sum = (pick: (line: Pick<EntryLineDraft, 'debit' | 'credit'>) => string) =>
    lines.reduce((total, line) => total + (amount(pick(line)) || 0), 0)
  const debit = sum(line => line.debit)
  const credit = sum(line => line.credit)
  return { debit, credit, difference: (cents(debit) - cents(credit)) / 100 }
}

/** The lines balance when both sides are equal and above zero. */
export const entryBalanced = (totals: EntryTotals) => totals.difference === 0 && cents(totals.debit) > 0

/** Exactly one of debit and credit is above zero on a line. */
function amountValid(line: EntryLineDraft): boolean {
  const debit = amount(line.debit)
  const credit = amount(line.credit)
  return Number.isFinite(debit) && Number.isFinite(credit) && (debit > 0) !== (credit > 0)
}

function lineProblems(line: EntryLineDraft): Partial<Record<EntryLineField, true>> {
  return {
    ...(line.accountId ? {} : { account: true as const }),
    ...(line.name.trim() ? {} : { name: true as const }),
    ...(amountValid(line) ? {} : { amount: true as const }),
  }
}

export function validateEntryDraft(draft: EntryFormDraft): EntryFormErrors {
  const totals = entryTotals(draft.lines)
  return {
    journal: !draft.journalId,
    date: !draft.date,
    tooFewLines: draft.lines.length < MIN_LINES,
    unbalanced: !entryBalanced(totals),
    lines: draft.lines.map(lineProblems),
  }
}

export function hasEntryErrors(errors: EntryFormErrors): boolean {
  return errors.journal || errors.date || errors.tooFewLines || errors.unbalanced || errors.lines.some(line => Object.keys(line).length > 0)
}

function linePayload(line: EntryLineDraft): JournalEntryLineInput {
  const debit = amount(line.debit)
  const credit = amount(line.credit)
  return {
    account_id: line.accountId!,
    ...(line.partnerId ? { partner_id: line.partnerId } : {}),
    name: line.name.trim(),
    ...(debit > 0 ? { debit } : { credit }),
  }
}

export function buildEntryCreate(draft: EntryFormDraft): JournalEntryCreate {
  const ref = draft.ref.trim()
  return {
    journal_id: draft.journalId!,
    date: draft.date!,
    ...(ref ? { ref } : {}),
    lines: draft.lines.map(linePayload),
  }
}

export function entryDraftDirty(draft: EntryFormDraft, initial: EntryFormDraft): boolean {
  const flat = (value: EntryFormDraft) => JSON.stringify({ ...value, lines: value.lines.map(({ key: _key, ...line }) => line) })
  return flat(draft) !== flat(initial)
}
