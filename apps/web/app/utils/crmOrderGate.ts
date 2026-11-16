import type { CrmOpportunity, SalesOrderState } from '@liwan/contracts'

/** The badge tone of each state of an order on the opportunity page: one entry per state the Sales contract names. */
export const OPPORTUNITY_ORDER_STATE_TONE = { draft: 'neutral', sent: 'info', confirmed: 'success', cancelled: 'destructive' } as const satisfies Record<SalesOrderState, string>

// What the opportunity page offers while Sales is in the plan (the Sales bridge). `win_by_order` is the tenant's fact; `can_quote`
// is the caller's right to write what wins. The quotation panel follows the caller's Sales right, the win action and the
// explanation follow `can_quote`, and only a pending opportunity is won.
type GateRecord = Pick<CrmOpportunity, 'status' | 'active' | 'customer' | 'win_by_order' | 'can_quote'>

export interface OrderGate {
  winByOrder: boolean
  /** Why a new quotation is not offered: a closed or archived opportunity, or one with no customer to write it for. */
  blocked: 'closed' | 'noCustomer' | null
  /** The panel's «new quotation»: the caller writes quotations and the opportunity takes one. */
  canAdd: boolean
  /** The header's «win with a quotation»: only while an order wins, the opportunity is pending and the caller may. */
  winAction: boolean
  /** An order wins and the caller may not write it: tell them to ask someone who can. */
  cannotQuote: boolean
}

export function opportunityOrderGate(record: GateRecord, writesQuotations: boolean): OrderGate {
  const blocked = !record.active || record.status === 'lost' ? 'closed' : record.customer ? null : 'noCustomer'
  const pending = record.status === 'pending' && record.active
  return {
    winByOrder: record.win_by_order,
    blocked,
    canAdd: writesQuotations && !blocked,
    winAction: record.win_by_order && pending && record.can_quote && writesQuotations && !blocked,
    cannotQuote: record.win_by_order && pending && !record.can_quote,
  }
}

/** The outcomes a call may be logged with: while an order wins, the sold outcome is not offered (the server refuses it). */
export function callOutcomesFor<Outcome extends { effect: string }>(outcomes: readonly Outcome[], winByOrder: boolean): Outcome[] {
  return outcomes.filter(outcome => !(winByOrder && outcome.effect === 'won'))
}
