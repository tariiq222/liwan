import type { FinanceActionBlockReason } from '@webvue/contracts'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'

/** The two lists every finance record carries: what the server lets the caller do now, and what it offers but refuses. */
interface ServerActions<A extends string> {
  allowed_actions: readonly A[]
  blocked_actions: readonly { action: A, reason: FinanceActionBlockReason }[]
}

export interface FinanceActions<A extends string> {
  /** The action can run now. */
  can: (action: A) => boolean
  /** The action is offered but refused now: its button shows disabled and the reason is explained. */
  blockedReason: (action: A) => FinanceActionBlockReason | null
  /** The record's state and the caller's role offer the action, whether or not it can run now. */
  offers: (action: A) => boolean
  /** Each distinct reason that blocks an offered action, in the server's order. */
  reasons: FinanceActionBlockReason[]
}

/**
 * Reads what the server decided; nothing is computed here. The server owns the rule (state, capability, the tenant's
 * write entitlement and the facts that refuse an action), so a page can never offer what its route will refuse.
 */
export function readFinanceActions<A extends string>(record: ServerActions<A>): FinanceActions<A> {
  const allowed = new Set<string>(record.allowed_actions)
  const blocked = new Map<string, FinanceActionBlockReason>(record.blocked_actions.map(item => [item.action, item.reason]))
  return {
    can: action => allowed.has(action),
    blockedReason: action => blocked.get(action) ?? null,
    offers: action => allowed.has(action) || blocked.has(action),
    reasons: [...new Set(record.blocked_actions.map(item => item.reason))],
  }
}

/** The menu rows of the offered actions, in the given order; a blocked one is disabled. */
export function offeredMenuItems<A extends string>(set: FinanceActions<A>, items: readonly (readonly [A, Omit<RowAction, 'disabled'>])[]): RowAction[] {
  return items.filter(([action]) => set.offers(action)).map(([action, item]) => ({ ...item, disabled: !set.can(action) }))
}
