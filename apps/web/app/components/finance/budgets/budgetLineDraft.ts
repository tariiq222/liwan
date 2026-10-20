import type { FinanceBudgetLineCreate } from '@webvue/contracts'

/** The add-line form as typed: the amount stays a string until it is validated. */
export interface BudgetLineDraft {
  accountId: number | null
  amount: string
  label: string
  dateFrom: string | null
  dateTo: string | null
}

export interface BudgetLineErrors {
  account: boolean
  amount: boolean
  /** The period ends before it starts. */
  order: boolean
}

export const emptyBudgetLine = (): BudgetLineDraft => ({ accountId: null, amount: '', label: '', dateFrom: null, dateTo: null })

/** A typed amount: a finite number of zero or more, else NaN. */
function amountOf(value: string): number {
  if (value.trim() === '') return Number.NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
}

export function validateBudgetLine(draft: BudgetLineDraft): BudgetLineErrors {
  return {
    account: !draft.accountId,
    amount: Number.isNaN(amountOf(draft.amount)),
    order: !!draft.dateFrom && !!draft.dateTo && draft.dateTo < draft.dateFrom,
  }
}

export const hasBudgetLineErrors = (errors: BudgetLineErrors) => Object.values(errors).some(Boolean)

/** The request body: the optional period and label are sent only when filled in (the period defaults to the budget's). */
export function buildBudgetLine(draft: BudgetLineDraft): FinanceBudgetLineCreate {
  const label = draft.label.trim()
  return {
    account_id: draft.accountId!,
    amount: amountOf(draft.amount),
    ...(label ? { label } : {}),
    ...(draft.dateFrom ? { date_from: draft.dateFrom } : {}),
    ...(draft.dateTo ? { date_to: draft.dateTo } : {}),
  }
}
