import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import type { AppointmentBookingListQuery, AppointmentBookingState } from '@liwan/contracts'

type Translate = (key: string) => string

export type AppointmentHeroTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral'

export interface AppointmentKpiScope {
  day: string
  type_id?: number
}

export const APPOINTMENT_KPI_KEYS = ['total', 'scheduled', 'confirmed', 'canceled'] as const
export type AppointmentKpiKey = typeof APPOINTMENT_KPI_KEYS[number]

const APPOINTMENT_STATE_TONES: Readonly<Record<AppointmentBookingState, StatusTone>> = {
  pending: 'warning',
  scheduled: 'info',
  confirmed: 'success',
  canceled: 'destructive',
}

const APPOINTMENT_HERO_TONES: Readonly<Record<AppointmentBookingState, AppointmentHeroTone>> = {
  pending: 'warning',
  scheduled: 'info',
  confirmed: 'success',
  canceled: 'neutral',
}

/** Semantic status badge tone for a booking state (DESIGN.md §2). */
export function appointmentStateTone(state: AppointmentBookingState): StatusTone {
  return APPOINTMENT_STATE_TONES[state]
}

/** Record hero surface tone for a booking state. */
export function appointmentHeroTone(state: AppointmentBookingState): AppointmentHeroTone {
  return APPOINTMENT_HERO_TONES[state]
}

/**
 * The limit=1 bookings query parameters for each KPI tile on /appointments.
 * Bookings on a day have a `start` date, so the day's breakdown covers all bookings on that day plus the three
 * scheduled-on-day states (`scheduled`, `confirmed`, `canceled`).
 */
export function appointmentKpiFilters(scope: AppointmentKpiScope): Record<AppointmentKpiKey, Partial<AppointmentBookingListQuery>> {
  const base: Partial<AppointmentBookingListQuery> = {
    from: scope.day,
    to: scope.day,
    ...(scope.type_id ? { type_id: scope.type_id } : {}),
    limit: 1,
  }
  return {
    total: base,
    scheduled: { ...base, state: 'scheduled' },
    confirmed: { ...base, state: 'confirmed' },
    canceled: { ...base, state: 'canceled' },
  }
}

/** The route targets of the four KPI tiles on /appointments, preserving the selected day and type filter. */
export function appointmentKpiLinks(scope: AppointmentKpiScope): Record<AppointmentKpiKey, string> {
  const base = { day: scope.day, type_id: scope.type_id }
  return {
    total: kpiLink('/appointments', base),
    scheduled: kpiLink('/appointments', { ...base, state: 'scheduled' }),
    confirmed: kpiLink('/appointments', { ...base, state: 'confirmed' }),
    canceled: kpiLink('/appointments', { ...base, state: 'canceled' }),
  }
}

/** Builds the four KPI tiles for /appointments; counts that have not arrived yet render as "—". */
export function appointmentListTiles(
  counts: Partial<Record<AppointmentKpiKey, number>>,
  links: Record<AppointmentKpiKey, string>,
  t: Translate,
): KpiTile[] {
  return [
    {
      id: 'total',
      label: t('appointments.kpi.total'),
      icon: 'i-lucide-calendar-clock',
      tone: 'neutral',
      value: counts.total ?? null,
      to: links.total,
    },
    {
      id: 'scheduled',
      label: t('appointments.kpi.scheduled'),
      icon: 'i-lucide-clock',
      tone: counts.scheduled ? 'warning' : 'neutral',
      value: counts.scheduled ?? null,
      to: links.scheduled,
      clearTo: links.total,
    },
    {
      id: 'confirmed',
      label: t('appointments.kpi.confirmed'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.confirmed ?? null,
      to: links.confirmed,
      clearTo: links.total,
    },
    {
      id: 'canceled',
      label: t('appointments.kpi.canceled'),
      icon: 'i-lucide-circle-x',
      tone: counts.canceled ? 'danger' : 'neutral',
      value: counts.canceled ?? null,
      to: links.canceled,
      clearTo: links.total,
    },
  ]
}
