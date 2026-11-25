import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string

/**
 * A figure a tile may show: `undefined` leaves the tile out (the page cannot know it), `null` is the server total still
 * loading and shows the strip's skeleton.
 */
type Figure = number | null | undefined

/** The `limit: 1` equipment requests behind the asset tiles; each asks only for the server total. */
export function hrEquipmentKpiQueries() {
  return {
    assigned: { assigned: 'true' as const, limit: 1, offset: 0 },
    available: { assigned: 'false' as const, limit: 1, offset: 0 },
  }
}

export interface HrEquipmentKpiFigures {
  /** Every active asset; the unfiltered list's own total answers this once it has arrived. */
  assets: Figure
  assigned: Figure
  available: Figure
}

/**
 * The tiles above the asset list: the active assets, and how many of them are with an employee or ready to hand out.
 * Only the three states the equipment endpoint filters on; the engine exposes no lost or in-maintenance state here.
 */
export function hrEquipmentKpiTiles(figures: HrEquipmentKpiFigures, t: Translate): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    figures.assets === undefined ? null : {
      id: 'assets',
      label: t('hrAssets.kpi.assets'),
      icon: 'i-lucide-laptop',
      tone: 'neutral',
      value: figures.assets,
      to: '/hr/assets',
    },
    figures.assigned === undefined ? null : {
      id: 'assigned',
      label: t('hrAssets.kpi.assigned'),
      icon: 'i-lucide-user-check',
      tone: 'neutral',
      value: figures.assigned,
      to: '/hr/assets?assigned=true',
      clearTo: '/hr/assets',
    },
    figures.available === undefined ? null : {
      id: 'available',
      label: t('hrAssets.kpi.available'),
      icon: 'i-lucide-package-open',
      tone: 'neutral',
      value: figures.available,
      to: '/hr/assets?assigned=false',
      clearTo: '/hr/assets',
    },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}

/** One `limit: 1` assignment request behind a shift tile, shaped like the list's own params. */
export interface HrShiftKpiQuery {
  employee_id: null
  schedule_id: null
  on_date: string | null
  limit: number
  offset: number
}

/**
 * The requests behind the shift list's tiles: every planned assignment, and the assignments running on the company's
 * calendar day. Without that day (the shift settings are not readable) the day's request carries no date and is not asked.
 */
export function hrShiftKpiQueries(today: string): { planned: HrShiftKpiQuery; today: HrShiftKpiQuery } {
  const base = { employee_id: null, schedule_id: null, limit: 1, offset: 0 }
  return {
    planned: { ...base, on_date: null },
    today: { ...base, on_date: today || null },
  }
}

/**
 * The tiles above the shift assignment list. The planned figure is the list's own total while its filters are empty;
 * the day's tile exists only once the company's day is known and links to that day's assignments.
 */
export function hrShiftKpiTiles(figures: { planned: Figure; today?: Figure }, today: string, t: Translate): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    figures.planned === undefined ? null : {
      id: 'planned',
      label: t('hrShifts.kpi.planned'),
      icon: 'i-lucide-calendar-clock',
      tone: 'neutral',
      value: figures.planned,
      to: '/hr/shifts',
    },
    !today || figures.today === undefined ? null : {
      id: 'today',
      label: t('hrShifts.kpi.today'),
      icon: 'i-lucide-calendar-days',
      tone: figures.today ? 'success' : 'neutral',
      value: figures.today,
      to: `/hr/shifts?on_date=${today}`,
      clearTo: '/hr/shifts',
    },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}

/** The `limit: 1` plan requests behind the insurance tiles: the plan states the endpoint filters on. */
export function hrInsurancePlanKpiQueries() {
  return {
    all: { limit: 1, offset: 0 },
    active: { state: 'active' as const, limit: 1, offset: 0 },
    expired: { state: 'expired' as const, limit: 1, offset: 0 },
  }
}

/**
 * The tiles above the plans section of the insurance list: all plans, the running ones and the lapsed ones. `to` keeps
 * the page on the plans section, and the two state tiles clear back to every plan.
 */
export function hrInsurancePlanKpiTiles(
  figures: { all: Figure; active: Figure; expired: Figure },
  t: Translate,
): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    figures.all === undefined ? null : {
      id: 'plans',
      label: t('hrInsurance.kpi.plans'),
      icon: 'i-lucide-clipboard-list',
      tone: 'neutral',
      value: figures.all,
      to: '/hr/insurance?section=plans',
    },
    figures.active === undefined ? null : {
      id: 'active',
      label: t('hrInsurance.kpi.plansActive'),
      icon: 'i-lucide-shield-check',
      tone: 'success',
      value: figures.active,
      to: '/hr/insurance?section=plans&plan_state=active',
      clearTo: '/hr/insurance?section=plans',
    },
    figures.expired === undefined ? null : {
      id: 'expired',
      label: t('hrInsurance.kpi.plansExpired'),
      icon: 'i-lucide-shield-off',
      tone: 'neutral',
      value: figures.expired,
      to: '/hr/insurance?section=plans&plan_state=expired',
      clearTo: '/hr/insurance?section=plans',
    },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}
