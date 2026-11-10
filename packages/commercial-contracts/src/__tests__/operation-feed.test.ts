import { expect, it } from 'vitest'
import { abandonJobRequestSchema, ABANDONABLE_OPERATIONS, operationFeedSchema, operationListStatusSchema, operationSchema, operationStatusesOf } from '../index.js'

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

it('expands the list status groups to the statuses the overview counts', () => {
  expect(operationStatusesOf('attention')).toEqual(['failed', 'needs_intervention'])
  expect(operationStatusesOf('pending')).toEqual(['queued', 'running'])
  expect(operationStatusesOf('verified')).toEqual(['verified'])
  expect(operationListStatusSchema.safeParse('bogus').success).toBe(false)
})

it('carries an abandoned shared job and the operator\'s latest abandon request', () => {
  const abandoned = { ...shared, type: 'backup', status: 'failed', stage: 'failed', reason: 'shared_execution_abandoned',
    abandonment: { state: 'abandoned', error: null, requested_at: '2026-11-10T00:00:00.000Z' } }
  expect(operationFeedSchema.parse(abandoned)).toEqual(abandoned)
  expect(operationFeedSchema.safeParse({ ...abandoned, abandonment: { state: 'done', error: null, requested_at: abandoned.abandonment.requested_at } }).success).toBe(false)
})
it('requires the job id as the abandon confirmation and nothing else', () => {
  const job = '10000000-0000-4000-8000-000000000001'
  expect(abandonJobRequestSchema.parse({ reason: 'Backup never started', confirm_job_id: job })).toEqual({ reason: 'Backup never started', confirm_job_id: job })
  for (const bad of [{ reason: 'Backup never started' }, { reason: 'no', confirm_job_id: job }, { reason: 'Backup never started', confirm_job_id: 'x' }, { reason: 'Backup never started', confirm_job_id: job, state: 'failed' }])
    expect(abandonJobRequestSchema.safeParse(bad).success).toBe(false)
})
it('lists exactly the operations a stuck job may be abandoned for', () => {
  expect([...ABANDONABLE_OPERATIONS]).toEqual(['backup', 'restore'])
})
