import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  sharedJobSchema, sharedJournalSchema, sharedObservationSchema, sharedReceiptSchema, tenantBindingSchema,
  type SharedJob, type TenantBinding,
} from '@nasq/commercial-contracts/shared'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export function assertSameBinding(expected: unknown, actual: unknown): void {
  const a = tenantBindingSchema.parse(expected)
  const b = tenantBindingSchema.parse(actual)
  if (a.tenantId !== b.tenantId || a.database !== b.database || a.filestore !== b.filestore || a.registryRevision !== b.registryRevision) throw new Error('tenant_binding_mismatch')
}

export function bindJob(input: unknown): SharedJob {
  const job = sharedJobSchema.parse(input)
  if (job.operation === 'restore') assertSameBinding(job.binding, job.backup.binding)
  return freeze(job)
}

export function businessKey(input: unknown): string {
  const job = bindJob(input)
  // Initial creation is unique for the entire tenant lifetime. A retry UUID,
  // host rename or failed attempt must never allocate a second tenant space.
  return JSON.stringify(['shared-v1', job.binding.tenantId, job.operation, job.operation === 'provision' ? 'initial' : job.requestId])
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function payloadDigest(input: unknown): string {
  const job = bindJob(input)
  // requestId is transport identity for provision, not a new business request.
  const payload = job.operation === 'provision' ? { ...job, requestId: undefined } : job
  if (job.operation === 'provision') delete payload.requestId
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

/** Receipt construction is deliberately separate from a reconciliation proposal. */
export function verifiedReceipt(input: unknown, currentTarget: unknown, durableJournal: unknown, observation: unknown) {
  const decision = reconcileSharedJob(input, currentTarget, durableJournal, observation)
  if (decision.action !== 'replay_verified') throw new Error('receipt_not_verified')
  const journal = sharedJournalSchema.parse(durableJournal)
  const job = bindJob(input)
  return freeze(sharedReceiptSchema.parse({
    schemaVersion: 1, operation: job.operation, binding: decision.binding,
    businessKey: decision.businessKey, payloadDigest: decision.payloadDigest,
    attemptId: journal.attemptId, sequence: journal.sequence, status: 'verified',
  }))
}

const targetSchema = tenantBindingSchema.extend({ enabled: z.boolean() })
export type SharedDecision = {
  action: 'persist_intent' | 'execute' | 'record_verified' | 'replay_verified' | 'needs_intervention'
  businessKey: string
  payloadDigest: string
  binding: TenantBinding
}

/** Pure planner, never executes an effect or marks a tenant active.
 * Caller MUST hold a fenced tenant lock, use fresh authoritative observation,
 * and persist/CAS journal transitions before invoking an effect adapter.
 */
export function reconcileSharedJob(input: unknown, currentTarget: unknown, durableJournal: unknown, observation: unknown): SharedDecision {
  const job = bindJob(input)
  const target = targetSchema.parse(currentTarget)
  const { enabled, ...currentBinding } = target
  if (!enabled) throw new Error('tenant_unavailable')
  assertSameBinding(job.binding, currentBinding)
  const key = businessKey(job)
  const hash = payloadDigest(job)
  const observed = sharedObservationSchema.parse(observation)
  const journal = durableJournal === null ? null : sharedJournalSchema.parse(durableJournal)
  if (journal) {
    bindJob(journal.job)
    assertSameBinding(job.binding, journal.job.binding)
    if (businessKey(journal.job) !== key || payloadDigest(journal.job) !== hash) throw new Error('idempotency_conflict')
  }
  if (observed.state === 'present') {
    assertSameBinding(job.binding, observed.binding)
    if (observed.businessKey !== key || observed.payloadDigest !== hash) throw new Error('effect_identity_mismatch')
  }
  let action: SharedDecision['action'] = 'needs_intervention'
  if (journal?.stage !== 'needs_intervention') {
    if (observed.state === 'absent') {
      if (!journal) action = 'persist_intent'
      else if (journal.stage === 'prepared') action = 'execute'
    } else if (observed.state === 'present' && observed.verified && journal) {
      action = journal.stage === 'verified' ? 'replay_verified' : 'record_verified'
    }
  }
  return freeze({ action, businessKey: key, payloadDigest: hash, binding: job.binding })
}
