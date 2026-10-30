import type { FinanceBankLine, FinanceBankStatement, FinanceBankStatementDetail } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const BANK_STATEMENTS_PATH = '/finance/bank/statements'
export const statementPath = (statementId: number) => `${BANK_STATEMENTS_PATH}/${statementId}`
export const reconcilePath = (statementId: number, lineId: number) => `${statementPath(statementId)}/lines/${lineId}`

export type BankLineState = 'reconciled' | 'open'

export const BANK_LINE_TONE: Record<BankLineState, StatusTone> = {
  reconciled: 'success',
  open: 'warning',
}

export const lineState = (line: Pick<FinanceBankLine, 'is_reconciled'>): BankLineState => line.is_reconciled ? 'reconciled' : 'open'

/** Money is compared to the cent: floating-point sums of two-decimal amounts never differ by more than half of it. */
const HALF_CENT = 0.005
export const sameMoney = (a: number, b: number) => Math.abs(a - b) < HALF_CENT
export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100 + 0

/** The statement's computed ending balance is not the one the bank printed. */
export const hasEndDifference = (statement: Pick<FinanceBankStatement, 'balance_end' | 'balance_end_real'>) =>
  !sameMoney(statement.balance_end, statement.balance_end_real)

export interface StatementSummary {
  reconciledCount: number
  openCount: number
  /** What the reconciled lines moved. */
  reconciledAmount: number
  /** What is still to reconcile on the open lines. */
  openAmount: number
  fullyReconciled: boolean
}

/** The figures of one statement, from its own lines (the detail payload carries every line). */
export function statementSummary(statement: Pick<FinanceBankStatementDetail, 'lines'>): StatementSummary {
  const reconciled = statement.lines.filter(line => line.is_reconciled)
  const open = statement.lines.filter(line => !line.is_reconciled)
  return {
    reconciledCount: reconciled.length,
    openCount: open.length,
    reconciledAmount: roundMoney(reconciled.reduce((sum, line) => sum + line.amount, 0)),
    openAmount: roundMoney(open.reduce((sum, line) => sum + line.amount_residual, 0)),
    fullyReconciled: statement.lines.length > 0 && open.length === 0,
  }
}
