import { expect, it } from 'vitest'
import { sharedBackupListSchema, sharedRestoreApprovalRequestSchema, sharedRestoreApprovalSchema } from '../index.js'

const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`
const listing = {
  start: { allowed: true, reason: null, job_id: null }, total: 1,
  items: [{ backup_id: id(1), job_id: id(2), created_at: '2026-11-22T10:00:00.000Z', started_by: 'Layla Operator',
    approval: { approval_id: id(3), expires_at: '2026-11-22T11:00:00.000Z', approved_by: null },
    restores: [{ job_id: id(4), approval_id: id(5), state: 'verified', created_at: '2026-11-22T10:30:00.000Z' }] }],
}
it('accepts a backups listing and a refused start that names the blocking job', () => {
  expect(sharedBackupListSchema.parse(listing)).toEqual(listing)
  const blocked = { ...listing, start: { allowed: false, reason: 'job_in_progress', job_id: id(6) } }
  expect(sharedBackupListSchema.parse(blocked)).toEqual(blocked)
})
it('rejects a start decision that contradicts itself and any field the browser must not see', () => {
  for (const start of [{ allowed: true, reason: 'job_in_progress', job_id: null }, { allowed: false, reason: null, job_id: null }, { allowed: false, reason: 'operations_unavailable', job_id: id(6) }, { allowed: false, reason: 'job_in_progress', job_id: null }]) {
    expect(sharedBackupListSchema.safeParse({ ...listing, start }).success).toBe(false)
  }
  const item = listing.items[0]!
  for (const extra of [{ artifact_path: '/private' }, { database_sha256: 'a'.repeat(64) }, { database_name: 'liwan_scratch_x' }]) {
    expect(sharedBackupListSchema.safeParse({ ...listing, items: [{ ...item, ...extra }] }).success).toBe(false)
  }
  expect(sharedBackupListSchema.safeParse({ ...listing, items: [{ ...item, restores: [{ ...item.restores[0], state: 'bogus' }] }] }).success).toBe(false)
})
it('takes only a backup id and a reason of 3 to 1000 characters to approve a restore', () => {
  expect(sharedRestoreApprovalRequestSchema.parse({ backup_id: id(1), reason: ' Restore check ' })).toEqual({ backup_id: id(1), reason: 'Restore check' })
  for (const bad of [{ backup_id: id(1), reason: 'ab' }, { backup_id: id(1), reason: 'x'.repeat(1001) }, { backup_id: 'nope', reason: 'Restore check' }, { backup_id: id(1), reason: 'Restore check', target: 'x' }]) {
    expect(sharedRestoreApprovalRequestSchema.safeParse(bad).success).toBe(false)
  }
  expect(sharedRestoreApprovalSchema.parse({ approval_id: id(3), expires_at: '2026-11-22T11:00:00.000Z' })).toEqual({ approval_id: id(3), expires_at: '2026-11-22T11:00:00.000Z' })
})
