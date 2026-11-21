import { RECOVERABLE_OPERATIONS } from '@liwan/commercial-contracts'

/** UI availability only. The control API and the shared worker enforce the grant, the operation and the observed effect again. */
export function canRecoverJob(operation: { source?: string; type: string; status: string; recovery?: { state: string } | null } | null | undefined,
  can: (capability: 'vendor.operations.run') => boolean): boolean {
  return operation?.source === 'shared' && operation.status === 'needs_intervention'
    && (RECOVERABLE_OPERATIONS as readonly string[]).includes(operation.type)
    && operation.recovery?.state !== 'pending' && can('vendor.operations.run')
}
