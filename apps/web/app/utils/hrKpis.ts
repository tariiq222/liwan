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
