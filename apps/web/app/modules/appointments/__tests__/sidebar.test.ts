import { describe, expect, it, vi } from 'vitest'
import { localIsoDay } from '@liwan/ui/app/utils/formatDate'
import manifest from '../manifest'
import { appointmentsSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => appointmentsSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the appointments sidebar menu', () => {
  it('is wired into the manifest with a pinned create link, bookings row, and recent bookings', () => {
    expect(manifest.sidebar).toBe(appointmentsSidebar)
    expect(manifest.contextLinks?.('/appointments').find(link => link.id === appointmentsSidebar.create)).toMatchObject({
      pinned: true,
      to: '/appointments/new',
      capability: 'appointments.bookings.manage',
    })
    expect(appointmentsSidebar.rows.map(item => [item.id, item.capability, item.to.path])).toEqual([
      ['appointments-bookings', 'appointments.bookings.read', '/appointments'],
    ])
    expect(appointmentsSidebar.recent).toMatchObject({
      kind: 'appointment',
      titleKey: 'appointments.nav.recent',
      capability: 'appointments.bookings.read',
    })
    expect(appointmentsSidebar.recent!.to(15)).toBe('/appointments/15')
  })

  it('lights the bookings row on the list and create panel, not on an opened booking record', () => {
    expect(activeRows(route('/appointments'))).toEqual(['appointments-bookings'])
    expect(activeRows(route('/appointments/', { day: '2026-11-25', state: 'confirmed' }))).toEqual(['appointments-bookings'])
    expect(activeRows(route('/appointments/new'))).toEqual(['appointments-bookings'])
    expect(activeRows(route('/appointments/9'))).toEqual([])
  })

  it('loads today booking count with limit=1 under appointments.bookings.read', async () => {
    const api = vi.fn().mockResolvedValueOnce({ items: [], total: 8 })
    const loader = appointmentsSidebar.counts![0]!
    const today = localIsoDay()

    expect(loader.capability).toBe('appointments.bookings.read')
    expect(loader.queryKey.slice(0, 2)).toEqual(['appointments', 'bookings'])
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ 'appointments-bookings': 8 })
    expect(api).toHaveBeenCalledWith('/api/v1/appointments/bookings', expect.objectContaining({
      query: { from: today, to: today, limit: 1 },
    }))
  })
})
