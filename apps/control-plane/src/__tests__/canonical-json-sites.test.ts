import { describe, expect, it } from 'vitest'
import { payloadDigest } from '../shared/provisioning.js'

// AUDIT-059: the control plane no longer keeps its own canonicalJson. The digest below was computed by the previous
// local copy for the same job, so moving to the shared function did not change a stored or cross-verified digest.
const job = {
  schemaVersion: 1, operation: 'provision', requestId: '11111111-1111-4111-8111-111111111111',
  binding: { tenantId: 'ta', database: `liwan_scratch_${'a'.repeat(32)}`, filestore: `liwan_scratch_${'a'.repeat(32)}`, registryRevision: 1 },
  catalog: { version: 'v1', tier: 'projects', sourceSha256: 'a'.repeat(64) },
  policy: { schema_version: 1, channel: 'control_plane', modules: ['liwan_core'], features: { 'users.limit': null, 'storage.limit_mb': null, 'pmo.enabled': true } },
}

describe('shared job payload digest', () => {
  it('is the digest the previous local canonicalJson produced', () => {
    expect(payloadDigest(job)).toBe('1f7c48674841d3a4c2cce1cc9c310860a1f76fe14306907339972e2de1b5f69d')
  })
  it('ignores the transport request id of a provision job', () => {
    expect(payloadDigest({ ...job, requestId: '22222222-2222-4222-8222-222222222222' })).toBe(payloadDigest(job))
  })
})
