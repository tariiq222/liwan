import { describe, expect, it } from 'vitest'
import { sharedJobSchema, tenantBindingSchema } from '@webvue/commercial-contracts/shared'
import { bindJob, businessKey, payloadDigest, reconcileSharedJob, assertSameBinding, verifiedReceipt } from './provisioning.js'

const binding = { tenantId: 'tenant_a', database: 'db_a', filestore: 'fs_a', registryRevision: 1 }
const target = { ...binding, enabled: true }
const request = {
  schemaVersion: 1, operation: 'provision', requestId: '11111111-1111-4111-8111-111111111111', binding,
  catalog: { version: 'v1', tier: 'basic', sourceSha256: 'a'.repeat(64) },
  policy: { schema_version: 1, channel: 'control_plane', modules: ['webvue_core'], features: { 'users.limit': null, 'storage.limit_mb': null } },
}
const job = () => bindJob(request)
const absent = { state: 'absent' }
const journal = (stage = 'prepared') => ({ schemaVersion: 1, job: job(), stage, attemptId: '22222222-2222-4222-8222-222222222222', sequence: 1 })
const present = () => ({ state: 'present', binding, businessKey: businessKey(job()), payloadDigest: payloadDigest(job()), verified: true })

describe('shared tenant-bound operation contract', () => {
  it('freezes a parsed identity independently of mutable caller inputs', () => {
    const input = structuredClone(request)
    const result = bindJob(input)
    input.binding.database = 'evil'
    expect(result.binding.database).toBe('db_a')
    expect(Object.isFrozen(result.binding)).toBe(true)
    if (result.operation !== 'provision') throw new Error('expected provision')
    expect(Object.isFrozen(result.policy)).toBe(true)
  })
  it('uses one provisioning business key even for a new request ID or revision', () => {
    expect(businessKey(job())).toBe(businessKey(bindJob({ ...request, requestId: '33333333-3333-4333-8333-333333333333', binding: { ...binding, registryRevision: 2 } })))
  })
  it('pins catalog and policy in the digest, not execution attempt', () => {
    expect(payloadDigest(job())).not.toBe(payloadDigest(bindJob({ ...request, catalog: { ...request.catalog, tier: 'premium' } })))
    expect(payloadDigest(job())).toBe(payloadDigest(bindJob({ ...request, policy: { ...request.policy, features: { 'storage.limit_mb': null, 'users.limit': null } } })))
  })
  it.each(['tenantId', 'database', 'filestore', 'registryRevision'] as const)('rejects %s mismatch before any action', (field) => {
    const wrong = { ...binding, [field]: field === 'registryRevision' ? 2 : 'other' }
    expect(() => assertSameBinding(binding, wrong)).toThrow('tenant_binding_mismatch')
    expect(() => reconcileSharedJob(job(), { ...wrong, enabled: true }, journal(), absent)).toThrow('tenant_binding_mismatch')
  })
  it('rejects disabled target', () => expect(() => reconcileSharedJob(job(), { ...target, enabled: false }, journal(), absent)).toThrow('tenant_unavailable'))
  it('requires a durable prepared journal before permitting effect', () => {
    expect(reconcileSharedJob(job(), target, null, absent).action).toBe('persist_intent')
    expect(reconcileSharedJob(job(), target, journal(), absent).action).toBe('execute')
  })
  it.each(['started', 'verified', 'needs_intervention'])('does not blindly recreate an absent effect after %s', (stage) => {
    expect(reconcileSharedJob(job(), target, journal(stage), absent).action).toBe('needs_intervention')
  })
  it('reconciles crash after effect using independently verified readback', () => {
    expect(reconcileSharedJob(job(), target, journal('started'), present()).action).toBe('record_verified')
    expect(reconcileSharedJob(job(), target, journal('verified'), present()).action).toBe('replay_verified')
  })
  it.each(['unknown', 'partial'])('refuses ambiguous %s observation', (state) => {
    expect(reconcileSharedJob(job(), target, journal(), { state }).action).toBe('needs_intervention')
  })
  it('refuses orphaned or unverified effects', () => {
    expect(reconcileSharedJob(job(), target, null, present()).action).toBe('needs_intervention')
    expect(reconcileSharedJob(job(), target, journal(), { ...present(), verified: false }).action).toBe('needs_intervention')
  })
  it.each(['businessKey', 'payloadDigest'])('rejects unrelated observed %s', (field) => {
    const wrong = { ...present(), [field]: field === 'payloadDigest' ? 'b'.repeat(64) : 'other' }
    expect(() => reconcileSharedJob(job(), target, journal(), wrong)).toThrow('effect_identity_mismatch')
  })
  it('rejects changed policy under an existing business key', () => {
    const previous = journal()
    previous.job = bindJob({ ...request, catalog: { ...request.catalog, tier: 'other' } })
    expect(() => reconcileSharedJob(job(), target, previous, absent)).toThrow('idempotency_conflict')
  })
  it('rejects unexpected command/secret fields and unsafe identifiers', () => {
    expect(sharedJobSchema.safeParse({ ...request, command: 'create' }).success).toBe(false)
    expect(tenantBindingSchema.safeParse({ ...binding, filestore: '../fs' }).success).toBe(false)
    expect(tenantBindingSchema.safeParse({ ...binding, registryRevision: 0 }).success).toBe(false)
  })
  it('emits a strict tenant-bound receipt only after durable verified readback', () => {
    expect(verifiedReceipt(job(), target, journal('verified'), present())).toMatchObject({ binding, status: 'verified', businessKey: businessKey(job()) })
    expect(() => verifiedReceipt(job(), target, journal('started'), present())).toThrow('receipt_not_verified')
    expect(() => verifiedReceipt(job(), target, journal('verified'), absent)).toThrow('receipt_not_verified')
  })
  it.each(['tenantId', 'database', 'filestore', 'registryRevision'] as const)('rejects observed %s mismatch', (field) => {
    expect(() => reconcileSharedJob(job(), target, journal(), { ...present(), binding: { ...binding, [field]: field === 'registryRevision' ? 2 : 'other' } })).toThrow('tenant_binding_mismatch')
  })
  it('rejects swapped journal identity', () => {
    expect(() => reconcileSharedJob(job(), target, { ...journal(), job: { ...job(), binding: { ...binding, tenantId: 'other' } } }, absent)).toThrow('tenant_binding_mismatch')
  })
  it('does not revive an intervention journal from a later observation', () => {
    expect(reconcileSharedJob(job(), target, journal('needs_intervention'), present()).action).toBe('needs_intervention')
  })
})

const backup = {
  schemaVersion: 1, backupId: '44444444-4444-4444-8444-444444444444', binding,
  databaseSha256: 'b'.repeat(64), filestoreSha256: 'c'.repeat(64), consistency: 'verified',
}
describe('backup and restore identity', () => {
  it('binds backup and restore to the same immutable resources', () => {
    const backed = bindJob({ schemaVersion: 1, operation: 'backup', binding, requestId: request.requestId })
    const restored = bindJob({ schemaVersion: 1, operation: 'restore', binding, requestId: request.requestId, backup, approvalId: request.requestId })
    expect(businessKey(backed)).not.toBe(businessKey(restored))
  })
  it.each(['tenantId', 'database', 'filestore', 'registryRevision'] as const)('rejects restore source %s mismatch', (field) => {
    expect(() => bindJob({ schemaVersion: 1, operation: 'restore', binding, requestId: request.requestId, approvalId: request.requestId, backup: { ...backup, binding: { ...binding, [field]: field === 'registryRevision' ? 2 : 'other' } } })).toThrow('tenant_binding_mismatch')
  })
  it('rejects unverified backups and missing approval', () => {
    expect(() => bindJob({ schemaVersion: 1, operation: 'restore', binding, requestId: request.requestId, backup: { ...backup, consistency: 'UNVERIFIED' } })).toThrow()
  })
})
