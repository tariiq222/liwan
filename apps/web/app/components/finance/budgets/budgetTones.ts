import type { FinanceBudget, FinanceBudgetLine } from '@webvue/contracts'
import type { StatusTone } from '@webvue/ui/app/utils/statusTone'

export const BUDGET_STATE_TONE: Record<FinanceBudget['state'], StatusTone> = {
  draft: 'neutral',
  confirmed: 'success',
  cancelled: 'destructive',
}

export const NATURE_TONE: Record<FinanceBudgetLine['nature'], StatusTone> = {
  debit: 'info',
  credit: 'success',
}
