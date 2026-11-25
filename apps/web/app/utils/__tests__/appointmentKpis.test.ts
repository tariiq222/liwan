import { describe, expect, it } from 'vitest'
import {
  APPOINTMENT_KPI_KEYS,
  appointmentHeroTone,
  appointmentKpiFilters,
  appointmentKpiLinks,
  appointmentListTiles,
  appointmentStateTone,
} from '../appointmentKpis'

const t = (key: string) => `t:${key}`

describe('appointment KPI filters and links', () => {
  it('builds limit=1 bookings query params scoped to the chosen day and optional type', () => {
    const plain = appointmentKpiFilters({ day: '2026-11-25' })
    expect(plain.total).toEqual({ from: '2026-11-25', to: '2026-11-25', limit: 1 })
    expect(plain.scheduled).toEqual({ from: '2026-11-25', to: '2026-11-25', state: 'scheduled', limit: 1 })
    expect(plain.confirmed).toEqual({ from: '2026-11-25', to: '2026-11-25', state: 'confirmed', limit: 1 })
    expect(plain.canceled).toEqual({ from: '2026-11-25', to: '2026-11-25', state: 'canceled', limit: 1 })

    const withType = appointmentKpiFilters({ day: '2026-11-25', type_id: 7 })
    expect(withType.total).toEqual({ from: '2026-11-25', to: '2026-11-25', type_id: 7, limit: 1 })
    expect(withType.confirmed).toEqual({ from: '2026-11-25', to: '2026-11-25', type_id: 7, state: 'confirmed', limit: 1 })
  })

  it('builds links targeting the same day with each state and preserves type_id', () => {
    expect(appointmentKpiLinks({ day: '2026-11-25' })).toEqual({
      total: '/appointments?day=2026-11-25',
      scheduled: '/appointments?day=2026-11-25&state=scheduled',
      confirmed: '/appointments?day=2026-11-25&state=confirmed',
      canceled: '/appointments?day=2026-11-25&state=canceled',
    })
    expect(appointmentKpiLinks({ day: '2026-11-25', type_id: 3 })).toEqual({
      total: '/appointments?day=2026-11-25&type_id=3',
      scheduled: '/appointments?day=2026-11-25&type_id=3&state=scheduled',
      confirmed: '/appointments?day=2026-11-25&type_id=3&state=confirmed',
      canceled: '/appointments?day=2026-11-25&type_id=3&state=canceled',
    })
  })
})

describe('appointment KPI tiles and state tones', () => {
  it('renders counts or null when pending, and sets clearTo back to the unfiltered day', () => {
    const links = appointmentKpiLinks({ day: '2026-11-25', type_id: 2 })
    const tiles = appointmentListTiles({ total: 10, scheduled: 3, confirmed: undefined, canceled: 0 }, links, t)

    expect(tiles.map(tile => tile.id)).toEqual([...APPOINTMENT_KPI_KEYS])
    expect(tiles.map(tile => [tile.id, tile.value, tile.tone, tile.to, tile.clearTo])).toEqual([
      ['total', 10, 'neutral', '/appointments?day=2026-11-25&type_id=2', undefined],
      ['scheduled', 3, 'warning', '/appointments?day=2026-11-25&type_id=2&state=scheduled', '/appointments?day=2026-11-25&type_id=2'],
      ['confirmed', null, 'success', '/appointments?day=2026-11-25&type_id=2&state=confirmed', '/appointments?day=2026-11-25&type_id=2'],
      ['canceled', 0, 'neutral', '/appointments?day=2026-11-25&type_id=2&state=canceled', '/appointments?day=2026-11-25&type_id=2'],
    ])
    expect(tiles[0]?.label).toBe('t:appointments.kpi.total')
    expect(appointmentListTiles({ total: 4, scheduled: 0, confirmed: 2, canceled: 2 }, links, t)[3]?.tone).toBe('danger')
  })

  it('maps booking states to semantic badge and hero tones', () => {
    expect(appointmentStateTone('pending')).toBe('warning')
    expect(appointmentStateTone('scheduled')).toBe('info')
    expect(appointmentStateTone('confirmed')).toBe('success')
    expect(appointmentStateTone('canceled')).toBe('destructive')

    expect(appointmentHeroTone('pending')).toBe('warning')
    expect(appointmentHeroTone('scheduled')).toBe('info')
    expect(appointmentHeroTone('confirmed')).toBe('success')
    expect(appointmentHeroTone('canceled')).toBe('neutral')
  })
})
