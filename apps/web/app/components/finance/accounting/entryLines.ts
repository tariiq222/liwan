import type { JournalEntryCreate, JournalEntryDetail, JournalEntryLine, JournalEntryLineInput, JournalEntryPatch } from '@webvue/contracts'

/** One line of the editor as typed: amounts stay strings until they are validated. */
interface EntryLineDraft {
  key: number
  accountId: number | null
  partnerId: number | null
  name: string
  debit: string
  credit: string
  /**
   * The stored analytic split of an edited line and the account it was stored with, sent back as it is while the line
   * keeps that account (`{}` keeps a line without a split). Null on a new line, or once the account changed: the key is
   * then left out and Odoo's distribution models may apply.
   */
  analytic: { accountId: number; split: Record<string, number> } | null
}

export interface EntryFormDraft {
  journalId: number | null
  date: string | null
  ref: string
  lines: EntryLineDraft[]
}

type EntryLineField = 'account' | 'name' | 'amount'
interface EntryFormErrors {
  journal: boolean
  date: boolean
  tooFewLines: boolean
  unbalanced: boolean
  lines: Array<Partial<Record<EntryLineField, true>>>
}

interface EntryTotals { debit: number; credit: number; difference: number }

const MIN_LINES = 2
/** Amounts are compared in hundredths, so typed decimals never fail a balance by floating-point dust. */
const cents = (value: number) => Math.round(value * 100)

let nextKey = 1
export function newEntryLine(): EntryLineDraft {
  return { key: nextKey++, accountId: null, partnerId: null, name: '', debit: '', credit: '', analytic: null }
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
    ...(line.analytic && line.analytic.accountId === line.accountId ? { analytic_distribution: line.analytic.split } : {}),
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

/** The request split of a stored line: one percent per analytic account, `{}` when the line has none. */
function analyticOf(line: JournalEntryLine): Record<string, number> {
  const split: Record<string, number> = {}
  for (const share of line.analytic_distribution) split[String(share.account.id)] = (split[String(share.account.id)] ?? 0) + share.percent
  return split
}

const typedAmount = (value: number) => value > 0 ? String(value) : ''

/** The editor of a draft entry, filled from the record: its header and every line as stored. */
export function entryDraftFromRecord(entry: JournalEntryDetail): EntryFormDraft {
  return {
    journalId: entry.journal.id,
    date: entry.date,
    ref: entry.ref,
    lines: entry.lines.map(line => ({
      key: nextKey++,
      accountId: line.account.id,
      partnerId: line.partner?.id ?? null,
      name: line.name,
      debit: typedAmount(line.debit),
      credit: typedAmount(line.credit),
      analytic: { accountId: line.account.id, split: analyticOf(line) },
    })),
  }
}

const flatLines = (draft: EntryFormDraft) => JSON.stringify(draft.lines.map(({ key: _key, ...line }) => line))

/**
 * The edit body: the header always, with an emptied reference sent as `''` so it clears. The lines are sent only when
 * they changed, because a body with `lines` replaces every line of the draft.
 */
export function buildEntryPatch(draft: EntryFormDraft, initial: EntryFormDraft): JournalEntryPatch {
  const { lines, ...header } = buildEntryCreate(draft)
  return {
    ...header,
    ref: draft.ref.trim(),
    ...(flatLines(draft) !== flatLines(initial) ? { lines } : {}),
  }
}

export function entryDraftDirty(draft: EntryFormDraft, initial: EntryFormDraft): boolean {
  const flat = (value: EntryFormDraft) => JSON.stringify({ ...value, lines: flatLines(value) })
  return flat(draft) !== flat(initial)
}
