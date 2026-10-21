import type { FinanceBankStatementDetail, FinanceBankStatementPatch } from '@webvue/contracts'
import { sameMoney } from './bankModel'

export interface StatementEditDraft { name: string; balanceStart: string; balanceEnd: string }

export const statementEditDraft = (statement: Pick<FinanceBankStatementDetail, 'name' | 'balance_start' | 'balance_end_real'>): StatementEditDraft =>
  ({ name: statement.name, balanceStart: String(statement.balance_start), balanceEnd: String(statement.balance_end_real) })

const numberOf = (value: string) => value.trim() === '' ? Number.NaN : Number(value)

export function validateStatementEdit(draft: StatementEditDraft): Partial<Record<'name' | 'balanceStart' | 'balanceEnd', true>> {
  return {
    ...(draft.name.trim() === '' ? { name: true as const } : {}),
    ...(Number.isFinite(numberOf(draft.balanceStart)) ? {} : { balanceStart: true as const }),
    ...(Number.isFinite(numberOf(draft.balanceEnd)) ? {} : { balanceEnd: true as const }),
  }
}

/** Only what changed is sent; null when nothing did. */
export function statementPatch(statement: Pick<FinanceBankStatementDetail, 'name' | 'balance_start' | 'balance_end_real'>, draft: StatementEditDraft): FinanceBankStatementPatch | null {
  const patch: FinanceBankStatementPatch = {
    ...(draft.name.trim() !== statement.name ? { name: draft.name.trim() } : {}),
    ...(!sameMoney(numberOf(draft.balanceStart), statement.balance_start) ? { balance_start: numberOf(draft.balanceStart) } : {}),
    ...(!sameMoney(numberOf(draft.balanceEnd), statement.balance_end_real) ? { balance_end_real: numberOf(draft.balanceEnd) } : {}),
  }
  return Object.keys(patch).length ? patch : null
}
