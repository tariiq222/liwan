import { describe, expect, it } from 'vitest'
import { operationRequestSchema, tenantCreateSchema } from '../index'
import { signServiceRequest, verifyServiceRequest } from '../server'

describe('commercial input contracts', () => {
  it('rejects a browser supplied target coordinate or authority', () => {
    expect(tenantCreateSchema.safeParse({ name: 'A', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: 'scratch-a', reason: 'Create', host: 'evil' }).success).toBe(false)
    expect(operationRequestSchema.safeParse({ type: 'health', request_id: 'ed71479b-938e-44f5-ae60-12f83bbcb521', reason: 'Check', actor: 9 }).success).toBe(false)
  })

  it('requires a complete entitlement request and forbids unsupported fields', () => {
    const base = { type: 'tenant.entitle', request_id: 'ed71479b-938e-44f5-ae60-12f83bbcb521', reason: 'Approved', expected_revision: 0, features: { 'pmo.enabled': true } }
    expect(operationRequestSchema.safeParse(base).success).toBe(true)
    expect(operationRequestSchema.safeParse({ ...base, expected_revision: undefined }).success).toBe(false)
    expect(operationRequestSchema.safeParse({ ...base, features: { local_policy: true } }).success).toBe(false)
  })
})

describe('service request signature', () => {
  const key = 'a'.repeat(64)
  const args = { method: 'POST', path: '/v1/tenants?q=one', body: '{"name":"One"}', actor: 17, issuer: 'company-installation', key, timestamp: 1_800_000_000, nonce: 'dc580fb5-3a64-43f6-b998-126591cbf2e0' }

  it('binds method, full path, actor, issuer, nonce, timestamp and exact body', () => {
    const headers = signServiceRequest(args)
    expect(verifyServiceRequest({ ...args, headers, now: 1_800_000_000 })).toEqual({ actor: 17, issuer: args.issuer, nonce: args.nonce, timestamp: args.timestamp })
    for (const change of [{ path: '/v1/tenants?q=two' }, { body: '{"name":"Two"}' }, { method: 'PUT' }, { actor: 18 }, { issuer: 'another' }, { timestamp: 1_800_000_001 }, { nonce: 'another' }]) {
      expect(verifyServiceRequest({ ...args, ...change, headers, now: 1_800_000_000 })).toBeNull()
    }
  })

  it('rejects stale signatures and short keys', () => {
    const headers = signServiceRequest(args)
    expect(verifyServiceRequest({ ...args, headers, now: 1_800_000_031 })).toBeNull()
    expect(() => signServiceRequest({ ...args, key: 'short' })).toThrow()
  })
})
