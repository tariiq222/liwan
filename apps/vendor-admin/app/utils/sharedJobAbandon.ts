import { ABANDONABLE_OPERATIONS } from '@liwan/commercial-contracts'

/** UI availability only. The control API and the shared worker enforce the grant, the operation and the absent effect again. */
export function canAbandonJob(operation: { source?: string; type: string; status: string; abandonment?: { state: string } | null } | null | undefined,
  can: (capability: 'vendor.operations.run') => boolean): boolean {
  return operation?.source === 'shared' && operation.status === 'needs_intervention'
    && (ABANDONABLE_OPERATIONS as readonly string[]).includes(operation.type)
    && operation.abandonment?.state !== 'pending' && can('vendor.operations.run')
}
