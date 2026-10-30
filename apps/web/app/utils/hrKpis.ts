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
    figures.archived === undefined ? null : { id: 'archived', label: t('hr.kpi.archived'), icon: 'i-lucide-archive', tone: 'neutral', value: figures.archived, to: '/hr?archived=1' },
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
 * The tiles above the department list. `departments` is the complete list (it is fetched page by page until the server
 * total is reached), so the counts are exact; `null` while it loads.
 */
export function departmentKpiTiles(departments: ReadonlyArray<{ manager: unknown }> | null, t: Translate): KpiTile[] {
  return [
    { id: 'departments', label: t('hr.kpi.departments'), icon: 'i-lucide-network', tone: 'neutral', value: departments ? departments.length : null },
    {
      id: 'unmanaged',
      label: t('hr.kpi.unmanaged'),
      icon: 'i-lucide-user-x',
      tone: departments?.some(department => !department.manager) ? 'warning' : 'neutral',
      value: departments ? departments.filter(department => !department.manager).length : null,
    },
  ]
}
