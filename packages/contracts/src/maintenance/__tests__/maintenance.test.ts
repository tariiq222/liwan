import { describe, expect, it } from 'vitest'
import { MaintenanceBookingInputSchema, MaintenancePreferencePatchSchema, MaintenanceSnapshotSchema } from '../index'

describe('maintenance scheduling contracts', () => {
  it('requires valid IANA zones, bounded windows and CAS revisions', () => {
    const value = { timezone: 'Asia/Riyadh', weekday: 6, startMinute: 120, durationMinutes: 60, revision: 0 }
    expect(MaintenancePreferencePatchSchema.parse(value)).toEqual(value)
    for (const patch of [{ timezone: 'Mars/Nowhere' }, { weekday: 7 }, { startMinute: 1440 }, { durationMinutes: 0 }, { revision: -1 }, { companyId: 2 }]) {
      expect(MaintenancePreferencePatchSchema.safeParse({ ...value, ...patch }).success).toBe(false)
    }
  })
  it('accepts a local wall time only with a declared published release id', () => {
    expect(MaintenanceBookingInputSchema.safeParse({ releaseId: 1, localDateTime: '2030-11-05T02:30', timezone: 'Europe/London', durationMinutes: 60 }).success).toBe(true)
    expect(MaintenanceBookingInputSchema.safeParse({ releaseId: 'invented', scheduledAt: '2030-01-01', status: 'complete' }).success).toBe(false)
  })
  it('allows an empty real snapshot without invented release data', () => {
    expect(MaintenanceSnapshotSchema.parse({ preference: null, releases: { items: [], total: 0 }, bookings: { items: [], total: 0 } }).preference).toBeNull()
  })
})
