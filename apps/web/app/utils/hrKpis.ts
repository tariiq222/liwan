import type { HrLeaveState, HrPayrollRunState } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'

type Translate = (key: string, named?: Record<string, unknown>, plural?: number) => string
type FormatNumber = (value: number, options?: Intl.NumberFormatOptions) => string

/**
 * A figure a tile may show: `undefined` leaves the tile out (the viewer lacks the capability behind it),
 * `null` is a figure still loading or unavailable and shows "—".
 */
type Figure<T = number> = T | null | undefined

export interface EmployeeKpiFigures {
  headcount: Figure
  archived: Figure
  saudiPercent: Figure
  expiring: Figure
  /** The look-ahead window `expiring` was counted over. */
  expiryDays: number
}

/** The tiles above the employee directory. Every figure is a server total, never a count of the loaded page. */
export function employeeKpiTiles(figures: EmployeeKpiFigures, t: Translate, n: FormatNumber): KpiTile[] {
  const tiles: Array<KpiTile | null> = [
    figures.headcount === undefined ? null : { id: 'headcount', label: t('hr.kpi.headcount'), icon: 'i-lucide-users', tone: 'neutral', value: figures.headcount },
    figures.archived === undefined ? null : { id: 'archived', label: t('hr.kpi.archived'), icon: 'i-lucide-archive', tone: 'neutral', value: figures.archived, to: '/hr?archived=1', clearTo: '/hr' },
    figures.saudiPercent === undefined ? null : {
      id: 'saudization',
      label: t('hr.kpi.saudization'),
      icon: 'i-lucide-percent',
      tone: 'success',
      value: figures.saudiPercent === null ? null : `${n(figures.saudiPercent, { maximumFractionDigits: 1 })}%`,
      ...(figures.saudiPercent === null ? {} : { progress: figures.saudiPercent }),
      to: '/hr/reports',
    },
    figures.expiring === undefined ? null : {
      id: 'expiring',
      label: t('hr.kpi.expiring'),
      icon: 'i-lucide-calendar-clock',
      tone: figures.expiring ? 'warning' : 'neutral',
      value: figures.expiring,
      hint: t('hr.kpi.expiringHint', { days: figures.expiryDays }, figures.expiryDays),
      to: '/hr/reports',
    },
  ]
  return tiles.filter((tile): tile is KpiTile => tile !== null)
}

/**
 * The tiles above the department list. The endpoint answers a `total` and the client fetches every page, so the
 * department count is the server total and the unmanaged count is exact over the complete list; `null` while loading.
 */
export function departmentKpiTiles(
  departments: { items: ReadonlyArray<{ manager: unknown }>; total: number } | null,
  t: Translate,
): KpiTile[] {
  return [
    { id: 'departments', label: t('hr.kpi.departments'), icon: 'i-lucide-network', tone: 'neutral', value: departments?.total ?? null },
    {
      id: 'unmanaged',
      label: t('hr.kpi.unmanaged'),
      icon: 'i-lucide-user-x',
      tone: departments?.items.some(department => !department.manager) ? 'warning' : 'neutral',
      value: departments ? departments.items.filter(department => !department.manager).length : null,
    },
  ]
}

/** One `limit: 1` leave request behind a tile, shaped like the list's own params. */
export interface HrLeaveKpiQuery {
  scope: 'pending' | 'all'
  state?: readonly HrLeaveState[]
  limit: number
  offset: number
}

/**
 * The requests behind the leave list's tiles. The contract has no date filter, so "this month" is not counted: pending
 * is the approver queue and approved is every request already validated.
 */
export function hrLeaveKpiQueries(): Record<'pending' | 'approved', HrLeaveKpiQuery> {
  return {
    pending: { scope: 'pending', limit: 1, offset: 0 },
    approved: { scope: 'all', state: ['validate'], limit: 1, offset: 0 },
  }
}

/**
 * The leave list's tiles: the pending queue and the approved requests. Pending is the list's own default view, so its
 * tile is active there and carries no `clearTo`: clicking it keeps the pending list instead of clearing to every request.
 */
export function hrLeaveKpiTiles(counts: { pending?: number; approved?: number }, t: Translate): KpiTile[] {
  return [
    {
      id: 'pending',
      label: t('hr.leave.kpi.pending'),
      icon: 'i-lucide-clock',
      tone: counts.pending ? 'warning' : 'neutral',
      value: counts.pending ?? null,
      to: '/hr/leave',
    },
    {
      id: 'approved',
      label: t('hr.leave.kpi.approved'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.approved ?? null,
    },
  ]
}

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

/** The run states that carry a tile: the runs still to compute, those awaiting approval and those approved. */
export const HR_PAYROLL_KPI_STATES = ['draft', 'computed', 'approved'] as const satisfies readonly HrPayrollRunState[]
export type HrPayrollKpiState = typeof HR_PAYROLL_KPI_STATES[number]

/**
 * The `limit: 1` run-list requests behind the payroll tiles, shaped like the list's own params: each tile reads only the
 * list `total`, never a run's amounts. `all` counts every run and is asked only when the list itself is narrowed.
 */
export function hrPayrollRunKpiQueries(): Record<'all' | HrPayrollKpiState, { state?: HrPayrollKpiState; limit: number; offset: number }> {
  return {
    all: { limit: 1, offset: 0 },
    draft: { state: 'draft', limit: 1, offset: 0 },
    computed: { state: 'computed', limit: 1, offset: 0 },
    approved: { state: 'approved', limit: 1, offset: 0 },
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

/**
 * The payroll runs list's tiles: counts of runs only. Each state tile filters the list by its state and clears back to
 * every run; `null` is a figure still loading and shows "—".
 */
export function hrPayrollRunKpiTiles(counts: Record<'all' | HrPayrollKpiState, number | null>, t: Translate): KpiTile[] {
  return [
    { id: 'all', label: t('hrPayroll.kpi.all'), icon: 'i-lucide-banknote', tone: 'neutral', value: counts.all, to: '/hr/payroll' },
    { id: 'draft', label: t('hrPayroll.kpi.draft'), icon: 'i-lucide-file-pen', tone: 'neutral', value: counts.draft, to: '/hr/payroll?state=draft', clearTo: '/hr/payroll' },
    {
      id: 'computed',
      label: t('hrPayroll.kpi.computed'),
      icon: 'i-lucide-clock',
      tone: counts.computed ? 'warning' : 'neutral',
      value: counts.computed,
      to: '/hr/payroll?state=computed',
      clearTo: '/hr/payroll',
    },
    { id: 'approved', label: t('hrPayroll.kpi.approved'), icon: 'i-lucide-circle-check', tone: 'success', value: counts.approved, to: '/hr/payroll?state=approved', clearTo: '/hr/payroll' },
  ]
}
