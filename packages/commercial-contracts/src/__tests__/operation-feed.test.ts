import { expect, it } from 'vitest'
import { operationFeedSchema, operationSchema } from '../index.js'

const shared = {
  source: 'shared', id: '10000000-0000-4000-8000-000000000001', tenant_id: '10000000-0000-4000-8000-000000000002',
  type: 'provision', status: 'verified', stage: 'verified', request_id: '10000000-0000-4000-8000-000000000003',
  reason: 'shared_execution_verified', result: null, created_at: '2026-10-01T00:00:00.000Z', updated_at: null, last_event_at: null,
}
it('accepts native shared verification with nullable event time without widening legacy status', () => {
  expect(operationFeedSchema.parse(shared)).toEqual(shared)
  expect(operationSchema.safeParse(shared).success).toBe(false)
})
it('rejects shared arbitrary diagnostics, fabricated update timestamps, and leaked payloads', () => {
  for (const extra of [{ result: { secret: 'value' } }, { payload: {} }, { reason: '/private/credentials' }, { updated_at: shared.created_at }, { status: 'succeeded' }]) {
    expect(operationFeedSchema.safeParse({ ...shared, ...extra }).success).toBe(false)
  }
})
