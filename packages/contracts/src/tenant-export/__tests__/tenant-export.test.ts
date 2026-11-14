import { describe, expect, it } from 'vitest'
import {
  TenantExportListSchema,
  TenantExportRequestSchema,
  TenantExportSchema,
} from '../index'

const DONE = {
  id: 3,
  state: 'done',
  requested_at: '2026-11-14T08:00:00Z',
  started_at: '2026-11-14T08:02:00Z',
  finished_at: '2026-11-14T08:05:00Z',
  expires_at: '2026-11-21T08:05:00Z',
  failure: null,
  size_bytes: 20480,
  counts: { rows: { companies: 2, users: 5 }, files: 3, not_included: 40 },
  downloadable: true,
}

describe('tenant export contracts', () => {
  it('accepts a finished run, a queued run and a failed run', () => {
    expect(TenantExportSchema.parse(DONE)).toEqual(DONE)
    const queued = { ...DONE, state: 'requested', started_at: null, finished_at: null, expires_at: null, size_bytes: 0, counts: null, downloadable: false }
    expect(TenantExportSchema.parse(queued).state).toBe('requested')
    expect(TenantExportSchema.parse({ ...queued, state: 'failed', failure: 'interrupted' }).failure).toBe('interrupted')
  })

  it('rejects an unknown state, a stray key and a negative size', () => {
    expect(TenantExportSchema.safeParse({ ...DONE, state: 'paused' }).success).toBe(false)
    expect(TenantExportSchema.safeParse({ ...DONE, path: '/tmp/x.zip' }).success).toBe(false)
    expect(TenantExportSchema.safeParse({ ...DONE, size_bytes: -1 }).success).toBe(false)
  })

  it('wraps the list in the items and total envelope with the retention', () => {
    expect(TenantExportListSchema.parse({ items: [DONE], total: 1, retention_days: 7 }).retention_days).toBe(7)
    expect(TenantExportListSchema.safeParse({ items: [DONE], total: 1 }).success).toBe(false)
  })

  it('takes no request field', () => {
    expect(TenantExportRequestSchema.safeParse({}).success).toBe(true)
    expect(TenantExportRequestSchema.safeParse({ reason: 'x' }).success).toBe(false)
  })
})
