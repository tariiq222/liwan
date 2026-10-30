import { describe, expect, it } from 'vitest'
import type { ProjectReportRow } from '@liwan/contracts'
import {
  projectBudgetHealthData,
  projectChartLabels,
  projectDashboardCurrencies,
  projectFinanceComparisonChart,
  projectFinanceComparisonData,
  projectProgressBandsChart,
  projectProgressBandData,
  projectProgressByProjectChart,
  projectProgressByProjectData,
  projectStatusDoughnutData,
  projectTaskCompositionData,
  projectTaskComposition,
} from '../projectChartData'

const SAR = { id: 1, name: 'Saudi Riyal', symbol: 'ر.س', decimal_places: 2 }
const USD = { id: 2, name: 'US Dollar', symbol: '$', decimal_places: 2 }
const labels = {
  status: { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', on_hold: 'On hold', done: 'Done', unset: 'Unset' },
  taskClosed: 'Closed', taskOpenOnTime: 'Open on time', taskOverdue: 'Overdue', progressNoTasks: 'No tasks', progressUnknown: 'Unknown', progress0to25: '0-25%', progress26to50: '26-50%', progress51to75: '51-75%', progress76to99: '76-99%', progress100: '100%', budgetUnknown: 'Unknown', budgetWithin: 'Within', budgetOver: 'Over', planned: 'Planned', actual: 'Actual', unavailable: 'Unavailable',
}

function row(id: number, overrides: Partial<ProjectReportRow> = {}): ProjectReportRow {
  return {
    project: { id, name: `Project ${id}`, status: 'on_track' },
    finance: { project_id: id, currency: SAR, charter_estimate: null, planned: 100, actual: 20, remaining: 80, utilization_percent: 20, over_budget: false, budget_count: 1, expense_count: 1, actual_source: 'manual', actual_account: null, can_read_actual_lines: false, can_choose_actual_account: false },
    task_count: 4,
    closed_task_count: 2,
    overdue_task_count: 1,
    progress: 50,
    ...overrides,
  }
}

describe('project dashboard chart data', () => {
  it('keeps unavailable task access distinct from a visible zero-task project', () => {
    expect(projectTaskComposition([row(1, { task_count: null, closed_task_count: null, overdue_task_count: null, progress: null })]).available).toBe(false)
    const bands = projectProgressBandData([row(1, { task_count: 0, closed_task_count: 0, overdue_task_count: 0, progress: 0 }), row(2, { task_count: null, closed_task_count: null, overdue_task_count: null, progress: null })], labels)
    expect(bands.available).toBe(true)
    expect(bands.data).toEqual(expect.arrayContaining([{ name: 'No tasks', value: 1 }]))
    expect(bands.data).toEqual(expect.arrayContaining([{ name: 'Unknown', value: 1 }]))
  })

  it('makes task composition disjoint by subtracting overdue from open tasks', () => {
    expect(projectTaskComposition([row(1)])).toEqual({ closed: 2, openOnTime: 1, overdue: 1, available: true })
  })

  it('keeps zero-valued donut categories so legends explain the complete distribution', () => {
    const one = row(1)
    const statuses = projectStatusDoughnutData([one], labels)
    const tasks = projectTaskCompositionData([one], labels)
    const budget = projectBudgetHealthData([one], labels)

    expect(statuses).toHaveLength(6)
    expect(statuses.find(item => item.name === 'Done')?.value).toBe(0)
    expect(tasks).toHaveLength(3)
    expect(tasks.find(item => item.name === 'Overdue')?.value).toBe(1)
    expect(budget).toHaveLength(3)
    expect(budget.find(item => item.name === 'Over')?.value).toBe(0)
  })

  it('orders unique currencies and never includes another currency in the comparison', () => {
    const rows = [row(1, { finance: { ...row(1).finance, currency: USD } }), row(2), row(3, { finance: { ...row(3).finance, currency: USD } })]
    expect(projectDashboardCurrencies(rows).map(currency => currency.id)).toEqual([1, 2])
    expect(projectFinanceComparisonData(rows, USD.id).map(item => item.projectId)).toEqual([1, 3])
  })

  it('keeps null plans as unknown and still counts their actual spend', () => {
    const budget = projectBudgetHealthData([row(1, { finance: { ...row(1).finance, planned: null } }), row(2)], labels)
    expect(budget.find(item => item.name === 'Unknown')?.value).toBe(1)
    expect(budget.find(item => item.name === 'Within')?.value).toBe(1)
  })

  it('labels zero-task progress separately from measured zero percent and unavailable progress', () => {
    const data = projectProgressByProjectData([
      row(1, { task_count: 0, closed_task_count: 0, overdue_task_count: 0, progress: 0 }),
      row(2, { task_count: 4, closed_task_count: 0, overdue_task_count: 0, progress: 0 }),
      row(3, { task_count: null, closed_task_count: null, overdue_task_count: null, progress: null }),
    ], labels)
    expect(data.map(item => [item.value, item.progressState])).toEqual([[0, 'no_tasks'], [0, 'tracked'], [0, 'unknown']])
  })

  it('keeps all project rows in compact chart models so scrolling can reveal every project', () => {
    const rows = Array.from({ length: 205 }, (_, index) => row(index + 1))
    const progress = projectProgressByProjectChart(rows, labels)
    const finance = projectFinanceComparisonChart(rows, SAR.id, labels)
    expect(progress.data).toHaveLength(205)
    expect(finance.data).toHaveLength(205)
    expect(finance.data.at(-1)).toMatchObject({ name: 'Project 205' })
    expect(projectProgressBandsChart(rows, labels).kind).toBe('bar')
  })
})

describe('dashboard chart labels', () => {
  it('maps every label to its projects locale key', () => {
    const labels = projectChartLabels(key => key)
    expect(labels.status).toEqual({
      on_track: 'projects.status.on_track',
      at_risk: 'projects.status.at_risk',
      off_track: 'projects.status.off_track',
      on_hold: 'projects.status.on_hold',
      done: 'projects.status.done',
      unset: 'projects.status.unset',
    })
    expect(labels.taskOverdue).toBe('projects.dashboard.charts.taskOverdue')
    expect(labels.progress100).toBe('projects.dashboard.charts.progress100')
    expect(labels.unavailable).toBe('projects.dashboard.unknown')
  })
})

describe('project status bars', () => {
  it('draws only present statuses as bars in their status tones', async () => {
    const { projectStatusBarChart } = await import('../projectChartData')
    const chart = projectStatusBarChart([row(1), row(2, { project: { id: 2, name: 'P2', status: 'at_risk' } })], labels)
    expect(chart.orientation).toBe('horizontal')
    expect(chart.valueFormat).toBe('number')
    expect(chart.data.map(item => [item.name, item.tone, item.values.count])).toEqual([['On track', 'success', 1], ['At risk', 'warning', 1]])
  })
})
