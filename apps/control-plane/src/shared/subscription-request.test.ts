import { describe, expect, it } from 'vitest'
import type { SharedReconfigureJob } from '@nasq/commercial-contracts/shared'
import { subscriptionRequest } from './odoo-adapter.js'

const job = {
  host: 'acme.example.test',
  binding: { database: 'nasq_scratch_' + 'a'.repeat(32), tenantId: 't', filestore: 'f', registryRevision: 1 },
  authority: { order_id: 'order-1', operation_id: 'op-1', target_revision_id: 'rev-1', entitlement: { digest: 'd' } },
} as unknown as SharedReconfigureJob

describe('subscriptionRequest', () => {
  const input = { job, action: 'reconfigure' as const, attemptId: 'attempt', fence: 3 }
  it('carries the enrolment administrator login stored by the control plane', () => {
    expect(subscriptionRequest(input, 'boss@acme.test')).toMatchObject({
      action: 'reconfigure', admin_login: 'boss@acme.test', attemptId: 'attempt', fence: 3,
      tenant: { database: job.binding.database, host: 'acme.example.test' }, order_id: 'order-1',
    })
  })
  it('omits the login when none is stored, so older tenants get no grant', () => {
    for (const none of [undefined, null, '']) expect(subscriptionRequest(input, none)).not.toHaveProperty('admin_login')
  })
})
