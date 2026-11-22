import { RECOVERABLE_OPERATIONS } from '@liwan/commercial-contracts'

/** UI availability only. The control API and the shared worker enforce the grant, the operation and the observed effect again. */
export function canRecoverJob(operation: { source?: string; type: string; status: string; recovery?: { state: string } | null } | null | undefined,
  can: (capability: 'vendor.operations.run') => boolean): boolean {
  return operation?.source === 'shared' && operation.status === 'needs_intervention'
    && (RECOVERABLE_OPERATIONS as readonly string[]).includes(operation.type)
    && operation.recovery?.state !== 'pending' && can('vendor.operations.run')
}

/** The recovery request outcomes that carry their own sentence: the observed effect belongs to another operation, so nothing was completed. */
const REFUSED_RECOVERY_ERRORS = ['effect_identity_mismatch']

/** The sentence for a recovery request: a refusal the worker named keeps its own text, every other outcome says its state. */
export const recoveryTextKey = (recovery: { state: string; error: string | null }): string =>
  recovery.state === 'failed' && recovery.error && REFUSED_RECOVERY_ERRORS.includes(recovery.error)
    ? `vendor.operations.recover.errors.${recovery.error}`
    : `vendor.operations.recover.states.${recovery.state}`
