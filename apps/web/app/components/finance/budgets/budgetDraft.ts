import type { FinanceBudgetCreate } from '@webvue/contracts'

/** The create form as typed. */
export interface BudgetFormDraft {
  name: string
  description: string
  dateFrom: string | null
  dateTo: string | null
}

export interface BudgetFormErrors {
  name: boolean
  dateFrom: boolean
  dateTo: boolean
  /** The period ends before it starts. */
  order: boolean
}

export const emptyBudgetDraft = (): BudgetFormDraft => ({ name: '', description: '', dateFrom: null, dateTo: null })

export function validateBudgetDraft(draft: BudgetFormDraft): BudgetFormErrors {
  return {
    name: !draft.name.trim(),
    dateFrom: !draft.dateFrom,
    dateTo: !draft.dateTo,
    order: !!draft.dateFrom && !!draft.dateTo && draft.dateTo < draft.dateFrom,
  }
}

export const hasBudgetErrors = (errors: BudgetFormErrors) => Object.values(errors).some(Boolean)

export function buildBudgetCreate(draft: BudgetFormDraft): FinanceBudgetCreate {
  const description = draft.description.trim()
  return {
    name: draft.name.trim(),
    ...(description ? { description } : {}),
    date_from: draft.dateFrom!,
    date_to: draft.dateTo!,
  }
}

export const budgetDraftDirty = (draft: BudgetFormDraft) => JSON.stringify(draft) !== JSON.stringify(emptyBudgetDraft())
