import { tenantDeletionStepNames, type TenantDeletionRequest, type TenantDeletionStepName } from '@liwan/commercial-contracts'

/** The request states the customer page shows: an open request or a finished deletion. A withdrawn one is history, unless its access was already stopped (`deleting_at` is set): its reinstatement must stay visible until it is done. */
const SHOWN_STATES: ReadonlyArray<TenantDeletionRequest['state']> = ['requested', 'confirmed', 'due', 'deleting', 'deleted']
export const isDeletionShown = (request: TenantDeletionRequest | null | undefined): request is TenantDeletionRequest =>
  Boolean(request && (SHOWN_STATES.includes(request.state) || (request.state === 'withdrawn' && request.deleting_at !== null)))

/** The vendor may withdraw until the point of no return: while the request is open, and while a running deletion has not committed. */
export function deletionWithdrawable(request: TenantDeletionRequest): boolean {
  return ['requested', 'confirmed', 'due'].includes(request.state) || (request.state === 'deleting' && request.committed_at === null)
}

/** `stuck_code` is `<step>:<code>` while the deletion is stuck or deferred; the step is validated against the contract, never trusted as a locale key. */
export function stuckParts(request: TenantDeletionRequest): { step: TenantDeletionStepName | null; code: string } | null {
  if (!request.stuck_code) return null
  const [first = '', ...rest] = request.stuck_code.split(':')
  const known = (tenantDeletionStepNames as readonly string[]).includes(first)
  return known && rest.length ? { step: first as TenantDeletionStepName, code: rest.join(':') } : { step: null, code: request.stuck_code }
}
