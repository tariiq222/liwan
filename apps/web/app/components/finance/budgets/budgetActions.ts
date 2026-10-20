import type { FinanceBudget } from '@webvue/contracts'

type Can = (capability: string) => boolean

export interface BudgetActionSet {
  confirm: boolean
  resetToDraft: boolean
  cancel: boolean
  editLines: boolean
}

/** What the record page offers: the budget's state decides what is possible, the capability decides who may. */
export function budgetActions(budget: Pick<FinanceBudget, 'state'>, can: Can): BudgetActionSet {
  const manage = can('finance.budgets.manage')
  const draft = budget.state === 'draft'
  return {
    confirm: draft && manage,
    resetToDraft: budget.state !== 'draft' && manage,
    cancel: budget.state !== 'cancelled' && manage,
    editLines: draft && manage,
  }
}
