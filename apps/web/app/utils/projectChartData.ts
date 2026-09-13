import type { ProjectReportRow, ProjectStatus } from '@nasq/contracts'

export type DashboardProject = ProjectReportRow & { updated_at?: string | null }

export type ChartLabels = {
  status: Record<ProjectStatus | 'unset', string>
  taskClosed: string
  taskOpenOnTime: string
  taskOverdue: string
  progressNoTasks: string
  progressUnknown: string
  progress0to25: string
  progress26to50: string
  progress51to75: string
  progress76to99: string
  progress100: string
  budgetUnknown: string
  budgetWithin: string
  budgetOver: string
  planned: string
  actual: string
  unavailable: string
}

export type ProjectDashboardMetric = {
  key: 'projects' | 'active' | 'taskProgress' | 'budgeted'
  value: number | null
  suffix?: '%'
}

export type DashboardCurrency = ProjectReportRow['finance']['currency']

export type ChartDatum = {
  name: string
  value: number
}

export type ProjectProgressState = 'tracked' | 'no_tasks' | 'unknown'

export type ProjectProgressPoint = ChartDatum & {
  projectId: number
  progressState: ProjectProgressState
  unavailable?: string
}

export type FinanceComparisonPoint = {
  name: string
  projectId: number
  planned: number | null
  actual: number
}

export type ChartPalette = 'status' | 'task' | 'budget' | 'primary' | 'finance'

export type DashboardDonutChart = {
  kind: 'donut'
  data: readonly ChartDatum[]
  palette: ChartPalette
  total: number
  centerLabel: string
  centerSubLabel: string
}

export type DashboardBarSeries = {
  key: string
  label: string
}

export type DashboardBarDatum = {
  name: string
  values: Record<string, number | null>
  displayValues?: Record<string, string>
  projectId?: number
  progressState?: ProjectProgressState
  unavailable?: string
  stateLabel?: string
}

export type DashboardBarChart = {
  kind: 'bar'
  orientation: 'horizontal' | 'vertical'
  data: readonly DashboardBarDatum[]
  series: readonly DashboardBarSeries[]
  palette: ChartPalette
  maxValue?: number
}

export type DashboardChart = DashboardDonutChart | DashboardBarChart

export function projectChartLabels(t: (key: string) => string): ChartLabels {
  return {
    status: {
      on_track: t('projects.status.on_track'),
      at_risk: t('projects.status.at_risk'),
      off_track: t('projects.status.off_track'),
      on_hold: t('projects.status.on_hold'),
      done: t('projects.status.done'),
      unset: t('projects.status.unset'),
    },
    taskClosed: t('projects.dashboard.charts.taskClosed'),
    taskOpenOnTime: t('projects.dashboard.charts.taskOpenOnTime'),
    taskOverdue: t('projects.dashboard.charts.taskOverdue'),
    progressNoTasks: t('projects.dashboard.charts.progressNoTasks'),
    progressUnknown: t('projects.dashboard.charts.progressUnknown'),
    progress0to25: t('projects.dashboard.charts.progress0to25'),
    progress26to50: t('projects.dashboard.charts.progress26to50'),
    progress51to75: t('projects.dashboard.charts.progress51to75'),
    progress76to99: t('projects.dashboard.charts.progress76to99'),
    progress100: t('projects.dashboard.charts.progress100'),
    budgetUnknown: t('projects.dashboard.charts.budgetUnknown'),
    budgetWithin: t('projects.dashboard.charts.budgetWithin'),
    budgetOver: t('projects.dashboard.charts.budgetOver'),
    planned: t('projects.dashboard.charts.planned'),
    actual: t('projects.dashboard.charts.actual'),
    unavailable: t('projects.dashboard.unknown'),
  }
}

const STATUS_ORDER: Array<ProjectStatus | null> = ['on_track', 'at_risk', 'off_track', 'on_hold', 'done', null]

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0
}

function knownTaskRows(rows: readonly ProjectReportRow[]) {
  return rows.filter(row => row.task_count != null && row.closed_task_count != null && row.overdue_task_count != null)
}

export function projectDashboardMetrics(rows: readonly ProjectReportRow[]): ProjectDashboardMetric[] {
  const taskRows = knownTaskRows(rows)
  const taskTotal = taskRows.reduce((sum, row) => sum + (row.task_count ?? 0), 0)
  const closedTotal = taskRows.reduce((sum, row) => sum + (row.closed_task_count ?? 0), 0)
  return [
    { key: 'projects', value: rows.length },
    { key: 'active', value: rows.filter(row => row.project.status !== 'done').length },
    { key: 'taskProgress', value: taskTotal > 0 ? percent(closedTotal, taskTotal) : taskRows.length ? 0 : null, suffix: '%' },
    { key: 'budgeted', value: rows.filter(row => row.finance.planned != null).length },
  ]
}

export function projectDashboardCurrencies(rows: readonly ProjectReportRow[]): DashboardCurrency[] {
  const currencies = new Map<number, DashboardCurrency>()
  for (const row of rows) currencies.set(row.finance.currency.id, row.finance.currency)
  return [...currencies.values()].sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id)
}

export function projectStatusDoughnutData(rows: readonly ProjectReportRow[], labels: ChartLabels): ChartDatum[] {
  const counts = new Map<ProjectStatus | null, number>(STATUS_ORDER.map(status => [status, 0]))
  for (const row of rows) counts.set(row.project.status, (counts.get(row.project.status) ?? 0) + 1)
  return STATUS_ORDER.map(status => ({
    name: status ? labels.status[status] : labels.status.unset,
    value: counts.get(status) ?? 0,
  }))
}

export function projectStatusDoughnutChart(rows: readonly ProjectReportRow[], labels: ChartLabels, centerSubLabel: string): DashboardDonutChart {
  const data = projectStatusDoughnutData(rows, labels)
  return { kind: 'donut', data, palette: 'status', total: rows.length, centerLabel: String(rows.length), centerSubLabel }
}

export type TaskComposition = { closed: number; openOnTime: number; overdue: number; available: boolean }

export function projectTaskComposition(rows: readonly ProjectReportRow[]): TaskComposition {
  const taskRows = knownTaskRows(rows)
  if (!taskRows.length) return { closed: 0, openOnTime: 0, overdue: 0, available: false }
  let closed = 0
  let openOnTime = 0
  let overdue = 0
  for (const row of taskRows) {
    const total = row.task_count ?? 0
    const done = Math.min(Math.max(row.closed_task_count ?? 0, 0), total)
    const open = total - done
    const late = Math.min(Math.max(row.overdue_task_count ?? 0, 0), open)
    closed += done
    overdue += late
    openOnTime += open - late
  }
  return { closed, openOnTime, overdue, available: true }
}

export function projectTaskCompositionData(rows: readonly ProjectReportRow[], labels: ChartLabels): ChartDatum[] {
  const task = projectTaskComposition(rows)
  if (!task.available) return []
  return [
    { name: labels.taskClosed, value: task.closed },
    { name: labels.taskOpenOnTime, value: task.openOnTime },
    { name: labels.taskOverdue, value: task.overdue },
  ]
}

export function projectTaskCompositionChart(rows: readonly ProjectReportRow[], labels: ChartLabels, centerSubLabel: string): DashboardDonutChart {
  const data = projectTaskCompositionData(rows, labels)
  return { kind: 'donut', data, palette: 'task', total: data.reduce((sum, item) => sum + item.value, 0), centerLabel: String(data.reduce((sum, item) => sum + item.value, 0)), centerSubLabel }
}

export function projectProgressBandData(rows: readonly ProjectReportRow[], labels: ChartLabels): { available: boolean; data: ChartDatum[] } {
  const values = new Map([
    [labels.progressNoTasks, 0], [labels.progressUnknown, 0], [labels.progress0to25, 0], [labels.progress26to50, 0], [labels.progress51to75, 0], [labels.progress76to99, 0], [labels.progress100, 0],
  ])
  let available = false
  for (const row of rows) {
    if (row.task_count == null || row.progress == null) {
      values.set(labels.progressUnknown, (values.get(labels.progressUnknown) ?? 0) + 1)
      continue
    }
    available = true
    if (row.task_count === 0) values.set(labels.progressNoTasks, (values.get(labels.progressNoTasks) ?? 0) + 1)
    else if (row.progress <= 25) values.set(labels.progress0to25, (values.get(labels.progress0to25) ?? 0) + 1)
    else if (row.progress <= 50) values.set(labels.progress26to50, (values.get(labels.progress26to50) ?? 0) + 1)
    else if (row.progress <= 75) values.set(labels.progress51to75, (values.get(labels.progress51to75) ?? 0) + 1)
    else if (row.progress < 100) values.set(labels.progress76to99, (values.get(labels.progress76to99) ?? 0) + 1)
    else values.set(labels.progress100, (values.get(labels.progress100) ?? 0) + 1)
  }
  return { available, data: [...values].map(([name, value]) => ({ name, value })) }
}

export function projectProgressBandsChart(rows: readonly ProjectReportRow[], labels: ChartLabels): DashboardBarChart {
  const bands = projectProgressBandData(rows, labels)
  return {
    kind: 'bar', orientation: 'vertical', palette: 'primary',
    data: bands.data.map(item => ({ name: item.name, values: { count: item.value } })),
    series: [{ key: 'count', label: '' }],
  }
}

export function projectBudgetHealthData(rows: readonly ProjectReportRow[], labels: ChartLabels): ChartDatum[] {
  let unknown = 0
  let within = 0
  let over = 0
  for (const row of rows) {
    if (row.finance.planned == null) unknown++
    else if (row.finance.over_budget || row.finance.actual > row.finance.planned) over++
    else within++
  }
  return [{ name: labels.budgetUnknown, value: unknown }, { name: labels.budgetWithin, value: within }, { name: labels.budgetOver, value: over }]
}

export function projectBudgetHealthChart(rows: readonly ProjectReportRow[], labels: ChartLabels, centerSubLabel: string): DashboardDonutChart {
  const data = projectBudgetHealthData(rows, labels)
  return { kind: 'donut', data, palette: 'budget', total: rows.length, centerLabel: String(rows.length), centerSubLabel }
}

function rowProgressState(row: ProjectReportRow): ProjectProgressState {
  if (row.task_count == null || row.progress == null) return 'unknown'
  if (row.task_count === 0) return 'no_tasks'
  return 'tracked'
}

export function projectProgressByProjectData(rows: readonly ProjectReportRow[], labels: ChartLabels): ProjectProgressPoint[] {
  return rows.map(row => {
    const progressState = rowProgressState(row)
    return {
      name: row.project.name,
      value: progressState === 'tracked' ? row.progress ?? 0 : 0,
      projectId: row.project.id,
      progressState,
      ...(progressState === 'unknown' ? { unavailable: labels.unavailable } : {}),
    }
  })
}

export function projectProgressByProjectChart(rows: readonly ProjectReportRow[], labels: ChartLabels): DashboardBarChart {
  const data = projectProgressByProjectData(rows, labels)
  return {
    kind: 'bar', orientation: 'horizontal', palette: 'primary', maxValue: 100,
    data: data.map(item => ({
      name: item.name,
      projectId: item.projectId,
      progressState: item.progressState,
      unavailable: item.unavailable,
      stateLabel: item.progressState === 'no_tasks' ? labels.progressNoTasks : item.unavailable,
      displayValues: { progress: item.progressState === 'tracked' ? `${item.value}%` : item.progressState === 'no_tasks' ? labels.progressNoTasks : labels.unavailable },
      values: { progress: item.progressState === 'tracked' ? item.value : null },
    })),
    series: [{ key: 'progress', label: '' }],
  }
}

export function projectFinanceComparisonData(rows: readonly ProjectReportRow[], currencyId: number): FinanceComparisonPoint[] {
  return rows.filter(row => row.finance.currency.id === currencyId).map(row => ({
    name: row.project.name,
    projectId: row.project.id,
    planned: row.finance.planned,
    actual: row.finance.actual,
  }))
}

export function projectFinanceComparisonChart(rows: readonly ProjectReportRow[], currencyId: number, labels: ChartLabels): DashboardBarChart {
  const data = projectFinanceComparisonData(rows, currencyId)
  const maxValue = Math.max(0, ...data.flatMap(item => [item.planned ?? 0, item.actual]))
  return {
    kind: 'bar', orientation: 'vertical', palette: 'finance', maxValue,
    data: data.map(item => ({
      name: item.name,
      projectId: item.projectId,
      displayValues: {
        planned: item.planned == null ? labels.unavailable : String(item.planned),
        actual: String(item.actual),
      },
      values: { planned: item.planned, actual: item.actual },
    })),
    series: [{ key: 'planned', label: labels.planned }, { key: 'actual', label: labels.actual }],
  }
}

export function projectDashboardHasTaskData(rows: readonly ProjectReportRow[]): boolean {
  return rows.some(row => row.task_count != null && row.closed_task_count != null && row.overdue_task_count != null)
}
