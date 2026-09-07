import type { ProjectReportRow, ProjectStatus } from '@nasq/contracts'

export type DashboardProject = ProjectReportRow & { updated_at?: string | null }
export type ChartOption = Record<string, unknown>

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

const COLORS = {
  // The brand link token is contrast-adjusted for the active surface. The
  // shell primary is allowed to match a dark card in the default theme.
  primary: 'var(--brand-link)',
  success: 'var(--status-success)',
  warning: 'var(--status-warning)',
  danger: 'var(--destructive)',
  muted: 'var(--muted-foreground)',
  border: 'var(--border)',
  foreground: 'var(--foreground)',
  card: 'var(--card)',
} as const

const STATUS_ORDER: Array<ProjectStatus | null> = ['on_track', 'at_risk', 'off_track', 'on_hold', 'done', null]
const BASE_OPTION = { animation: false } as const

function chartText(name: string, value: unknown, color: string = COLORS.foreground) {
  return { name, value, itemStyle: { color }, emphasis: { itemStyle: { color } } }
}

function escapeTooltipText(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

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

export function projectStatusDoughnutData(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  const counts = new Map<ProjectStatus | null, number>(STATUS_ORDER.map(status => [status, 0]))
  for (const row of rows) counts.set(row.project.status, (counts.get(row.project.status) ?? 0) + 1)
  return STATUS_ORDER
    .map((status, index) => chartText(status ? labels.status[status] : labels.status.unset, counts.get(status) ?? 0, [COLORS.primary, COLORS.warning, COLORS.danger, COLORS.muted, COLORS.success, COLORS.muted][index]))
    .filter(item => Number(item.value) > 0)
}

export function projectStatusDoughnutOption(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  return {
    ...BASE_OPTION,
    color: [COLORS.primary, COLORS.warning, COLORS.danger, COLORS.muted, COLORS.success, COLORS.muted],
    aria: { enabled: true, decal: { show: false } },
    tooltip: { trigger: 'item', confine: true, formatter: (item: { name: string; value: number; percent: number }) => `${escapeTooltipText(item.name)}: ${item.value} (${item.percent}%)` },
    legend: { bottom: 0, left: 'center', type: 'scroll', textStyle: { color: COLORS.foreground } },
    series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '43%'], avoidLabelOverlap: true, itemStyle: { borderColor: COLORS.card, borderWidth: 3 }, label: { show: false }, emphasis: { label: { show: true, fontWeight: 600, color: COLORS.foreground } }, data: projectStatusDoughnutData(rows, labels) }],
  }
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

export function projectTaskCompositionData(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  const task = projectTaskComposition(rows)
  return [
    chartText(labels.taskClosed, task.closed, COLORS.success),
    chartText(labels.taskOpenOnTime, task.openOnTime, COLORS.primary),
    chartText(labels.taskOverdue, task.overdue, COLORS.danger),
  ].filter(item => Number(item.value) > 0)
}

export function projectTaskCompositionOption(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  return {
    ...BASE_OPTION,
    color: [COLORS.success, COLORS.primary, COLORS.danger],
    aria: { enabled: true },
    tooltip: { trigger: 'item', confine: true, formatter: (item: { name: string; value: number; percent: number }) => `${escapeTooltipText(item.name)}: ${item.value} (${item.percent}%)` },
    legend: { bottom: 0, left: 'center', type: 'scroll', textStyle: { color: COLORS.foreground } },
    series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '43%'], itemStyle: { borderColor: COLORS.card, borderWidth: 3 }, label: { show: false }, emphasis: { label: { show: true, fontWeight: 600, color: COLORS.foreground } }, data: projectTaskCompositionData(rows, labels) }],
  }
}

export function projectProgressBandData(rows: readonly ProjectReportRow[], labels: ChartLabels) {
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
  return { available, data: [...values].map(([name, value]) => chartText(name, value)).filter(item => Number(item.value) > 0) }
}

export function projectProgressBandsOption(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  const bands = projectProgressBandData(rows, labels)
  return {
    ...BASE_OPTION,
    aria: { enabled: true },
    grid: { top: 18, left: 12, right: 20, bottom: 20, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, valueFormatter: (value: number) => String(value) },
    xAxis: { type: 'category', data: bands.data.map(item => item.name), axisTick: { show: false }, axisLabel: { color: COLORS.muted, interval: 0, hideOverlap: true } },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: COLORS.muted }, splitLine: { lineStyle: { color: COLORS.border } } },
    series: [{ type: 'bar', barMaxWidth: 34, data: bands.data.map(item => ({ ...item, itemStyle: { color: COLORS.primary } })) }],
  }
}

export function projectBudgetHealthData(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  let unknown = 0
  let within = 0
  let over = 0
  for (const row of rows) {
    if (row.finance.planned == null) unknown++
    else if (row.finance.over_budget || row.finance.actual > row.finance.planned) over++
    else within++
  }
  return [chartText(labels.budgetUnknown, unknown, COLORS.muted), chartText(labels.budgetWithin, within, COLORS.success), chartText(labels.budgetOver, over, COLORS.danger)].filter(item => Number(item.value) > 0)
}

export function projectBudgetHealthOption(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  return {
    ...BASE_OPTION,
    color: [COLORS.muted, COLORS.success, COLORS.danger],
    aria: { enabled: true },
    tooltip: { trigger: 'item', confine: true, formatter: (item: { name: string; value: number; percent: number }) => `${escapeTooltipText(item.name)}: ${item.value} (${item.percent}%)` },
    legend: { bottom: 0, left: 'center', type: 'scroll', textStyle: { color: COLORS.foreground } },
    series: [{ type: 'pie', radius: ['48%', '72%'], center: ['50%', '43%'], itemStyle: { borderColor: COLORS.card, borderWidth: 3 }, label: { show: false }, emphasis: { label: { show: true, fontWeight: 600, color: COLORS.foreground } }, data: projectBudgetHealthData(rows, labels) }],
  }
}

export type ProjectProgressPoint = {
  name: string
  value: number
  projectId: number
  progressState: 'tracked' | 'no_tasks' | 'unknown'
  itemStyle: { color: string; opacity?: number }
  unavailable?: string
}

function rowProgressState(row: ProjectReportRow): ProjectProgressPoint['progressState'] {
  if (row.task_count == null || row.progress == null) return 'unknown'
  if (row.task_count === 0) return 'no_tasks'
  return 'tracked'
}

export function projectProgressByProjectData(rows: readonly ProjectReportRow[], labels: ChartLabels): ProjectProgressPoint[] {
  return rows.map(row => {
    const progressState = rowProgressState(row)
    return {
      name: row.project.name,
      // Zero is only the chart position for states without measurable task
      // progress; labels and tooltips carry the state explicitly.
      value: progressState === 'tracked' ? row.progress ?? 0 : 0,
      projectId: row.project.id,
      progressState,
      itemStyle: progressState === 'tracked' ? { color: COLORS.primary } : { color: COLORS.muted, opacity: 0.28 },
      ...(progressState === 'unknown' ? { unavailable: labels.unavailable } : {}),
    }
  })
}

export function projectProgressByProjectOption(rows: readonly ProjectReportRow[], labels: ChartLabels) {
  const data = projectProgressByProjectData(rows, labels)
  const many = data.length > 8
  return {
    ...BASE_OPTION,
    aria: { enabled: true },
    grid: { top: 12, left: 10, right: many ? 44 : 24, bottom: 12, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: (params: Array<{ name: string; value: number; data?: ProjectProgressPoint }>) => { const item = params[0]; if (!item) return ''; const state = item.data?.progressState; const value = state === 'no_tasks' ? labels.progressNoTasks : state === 'unknown' ? labels.unavailable : `${item.value}%`; return `${escapeTooltipText(item.name)}: ${escapeTooltipText(value)}` } },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: COLORS.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: COLORS.border } } },
    yAxis: { type: 'category', inverse: true, data: data.map(item => item.name), axisLabel: { color: COLORS.foreground, width: 140, overflow: 'truncate' }, axisTick: { show: false } },
    dataZoom: many ? [{ type: 'inside', yAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100) }, { type: 'slider', yAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100), width: 10, right: 4, borderColor: COLORS.border, fillerColor: 'color-mix(in srgb, var(--brand-link) 24%, transparent)' }] : undefined,
    media: [
      { query: { maxWidth: 480 }, option: {
        grid: { left: 8, right: many ? 46 : 24, bottom: 16 },
        xAxis: { splitNumber: 2 },
        yAxis: { axisLabel: { width: 95, overflow: 'truncate' } },
      } },
      { option: {
        grid: { left: 10, right: many ? 44 : 24, bottom: 12 },
        xAxis: { splitNumber: 5 },
        yAxis: { axisLabel: { width: 140, overflow: 'truncate' } },
      } },
    ],
    series: [{ type: 'bar', barMaxWidth: 18, showBackground: true, backgroundStyle: { color: 'color-mix(in srgb, var(--muted) 60%, transparent)' }, label: { show: true, position: 'right', color: COLORS.foreground, formatter: (item: { value: number; data?: ProjectProgressPoint }) => item.data?.progressState === 'no_tasks' ? labels.progressNoTasks : item.data?.progressState === 'unknown' ? labels.unavailable : `${item.value}%` }, data }],
  }
}

export function projectFinanceComparisonData(rows: readonly ProjectReportRow[], currencyId: number) {
  return rows.filter(row => row.finance.currency.id === currencyId).map(row => ({
    name: row.project.name,
    projectId: row.project.id,
    planned: row.finance.planned,
    actual: row.finance.actual,
  }))
}

export function projectFinanceComparisonOption(rows: readonly ProjectReportRow[], currencyId: number, labels: ChartLabels) {
  const data = projectFinanceComparisonData(rows, currencyId)
  const many = data.length > 8
  return {
    ...BASE_OPTION,
    aria: { enabled: true },
    legend: { top: 0, right: 0, textStyle: { color: COLORS.foreground } },
    grid: { top: 36, left: 10, right: many ? 44 : 24, bottom: many ? 46 : 34, containLabel: true },
    tooltip: { trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: (params: Array<{ seriesName: string; name: string; value: number | null }>) => { const first = params[0]; if (!first) return ''; return [escapeTooltipText(first.name), ...params.map(item => `${escapeTooltipText(item.seriesName)}: ${item.value == null ? escapeTooltipText(labels.unavailable) : item.value}`)].join('<br>') } },
    xAxis: { type: 'category', data: data.map(item => item.name), axisLabel: { color: COLORS.foreground, rotate: data.length > 5 ? 24 : 0, interval: 0, hideOverlap: true }, axisTick: { show: false } },
    yAxis: { type: 'value', min: 0, axisLabel: { color: COLORS.muted }, splitLine: { lineStyle: { color: COLORS.border } } },
    dataZoom: many ? [{ type: 'inside', xAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100) }, { type: 'slider', xAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100), height: 10, bottom: 4, borderColor: COLORS.border, fillerColor: 'color-mix(in srgb, var(--brand-link) 24%, transparent)' }] : undefined,
    media: [
      { query: { maxWidth: 480 }, option: {
        grid: { left: 8, right: 24, bottom: many ? 64 : 42 },
        xAxis: { axisLabel: { width: 80, overflow: 'truncate', rotate: data.length > 3 ? 20 : 0 } },
        dataZoom: many ? [{ type: 'inside', xAxisIndex: 0, start: 0, end: Math.min(100, (3 / data.length) * 100) }, { type: 'slider', xAxisIndex: 0, start: 0, end: Math.min(100, (3 / data.length) * 100), height: 10, bottom: 8, borderColor: COLORS.border, fillerColor: 'color-mix(in srgb, var(--brand-link) 24%, transparent)' }] : undefined,
      } },
      { option: {
        grid: { left: 10, right: many ? 44 : 24, bottom: many ? 46 : 34 },
        xAxis: { axisLabel: { width: 140, overflow: 'truncate', rotate: data.length > 5 ? 24 : 0 } },
        dataZoom: many ? [{ type: 'inside', xAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100) }, { type: 'slider', xAxisIndex: 0, start: 0, end: Math.min(100, (8 / data.length) * 100), height: 10, bottom: 4, borderColor: COLORS.border, fillerColor: 'color-mix(in srgb, var(--brand-link) 24%, transparent)' }] : undefined,
      } },
    ],
    series: [
      { name: labels.planned, type: 'bar', barMaxWidth: 20, itemStyle: { color: COLORS.primary }, data: data.map(item => item.planned) },
      { name: labels.actual, type: 'bar', barMaxWidth: 20, itemStyle: { color: COLORS.warning }, data: data.map(item => item.actual) },
    ],
  }
}

export function projectDashboardHasTaskData(rows: readonly ProjectReportRow[]): boolean {
  return rows.some(row => row.task_count != null && row.closed_task_count != null && row.overdue_task_count != null)
}
