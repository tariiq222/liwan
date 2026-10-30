import { FinanceBankReconcileSchema, type FinanceAccount, type FinanceBankReconcile, type FinanceReconcileProposal } from '@liwan/contracts'
import { roundMoney, sameMoney } from './bankModel'

/** The leftover of a reconciliation is never booked on these (the server refuses them): receivable, payable and liquidity. */
const NON_WRITE_OFF_TYPES: readonly FinanceAccount['account_type'][] = ['asset_receivable', 'liability_payable', 'asset_cash', 'liability_credit_card']

export const canWriteOffTo = (account: Pick<FinanceAccount, 'account_type'>) => !NON_WRITE_OFF_TYPES.includes(account.account_type)

/** The ticked ids after one item is ticked (`on`) or cleared, in the order they were ticked. */
export function toggleSelected(selected: readonly number[], id: number, on: boolean): number[] {
  const rest = selected.filter(value => value !== id)
  return on ? [...rest, id] : rest
}

/** What the ticked open items clear of the line. */
export function selectedTotal(proposals: readonly Pick<FinanceReconcileProposal, 'id' | 'amount_residual'>[], selected: readonly number[]): number {
  return roundMoney(proposals.filter(proposal => selected.includes(proposal.id)).reduce((sum, proposal) => sum + proposal.amount_residual, 0))
}

/** What stays uncleared: the line's residual less the ticked items. */
export const remainingDifference = (lineResidual: number, selected: number) => roundMoney(lineResidual - selected)

export interface WriteOff {
  accountId: number | null
  label: string
}

/**
 * The reconcile body: the ticked items, and, only while a difference remains, the account that takes it with its
 * optional label. Null when the contract would refuse it (nothing chosen, or a difference without an account).
 */
export function buildReconcileBody(selected: readonly number[], difference: number, writeOff: WriteOff): FinanceBankReconcile | null {
  const writing = !sameMoney(difference, 0)
  if (writing && !writeOff.accountId) return null
  const label = writeOff.label.trim()
  const parsed = FinanceBankReconcileSchema.safeParse({
    ...(selected.length ? { move_line_ids: [...selected] } : {}),
    ...(writing ? { account_id: writeOff.accountId, ...(label ? { label } : {}) } : {}),
  })
  return parsed.success ? parsed.data : null
}
