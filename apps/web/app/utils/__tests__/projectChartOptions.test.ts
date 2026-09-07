import { describe, expect, it } from 'vitest'
import type { ProjectReportRow } from '@nasq/contracts'
import {
  projectBudgetHealthData,
  projectDashboardCurrencies,
  projectFinanceComparisonData,
  projectFinanceComparisonOption,
  projectProgressBandData,
  projectProgressByProjectData,
  projectProgressByProjectOption,
  projectTaskComposition,
} from '../projectChartOptions'

const SAR = { id: 1, name: 'Saudi Riyal', symbol: 'ر.س', decimal_places: 2 }
const USD = { id: 2, name: 'US Dollar', symbol: '$', decimal_places: 2 }
const labels = {
  status: { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track', on_hold: 'On hold', done: 'Done', unset: 'Unset' },
  taskClosed: 'Closed', taskOpenOnTime: 'Open on time', taskOverdue: 'Overdue', progressNoTasks: 'No tasks', progressUnknown: 'Unknown', progress0to25: '0-25%', progress26to50: '26-50%', progress51to75: '51-75%', progress76to99: '76-99%', progress100: '100%', budgetUnknown: 'Unknown', budgetWithin: 'Within', budgetOver: 'Over', planned: 'Planned', actual: 'Actual', unavailable: 'Unavailable',
}

function row(id: number, overrides: Partial<ProjectReportRow> = {}): ProjectReportRow {
  return {
    project: { id, name: `Project ${id}`, status: 'on_track' },
    finance: { project_id: id, currency: SAR, charter_estimate: null, planned: 100, actual: 20, remaining: 80, utilization_percent: 20, over_budget: false, budget_count: 1, expense_count: 1 },
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
    expect(bands.data).toEqual(expect.arrayContaining([{ name: 'No tasks', value: 1, itemStyle: expect.any(Object), emphasis: expect.any(Object) }]))
    expect(bands.data).toEqual(expect.arrayContaining([{ name: 'Unknown', value: 1, itemStyle: expect.any(Object), emphasis: expect.any(Object) }]))
  })

  it('makes task composition disjoint by subtracting overdue from open tasks', () => {
    expect(projectTaskComposition([row(1)])).toEqual({ closed: 2, openOnTime: 1, overdue: 1, available: true })
  })

  it('orders unique currencies and never includes another currency in the comparison', () => {
    const rows = [row(1, { finance: { ...row(1).finance, currency: USD } }), row(2), row(3, { finance: { ...row(3).finance, currency: USD } })]
    expect(projectDashboardCurrencies(rows).map(currency => currency.id)).toEqual([1, 2])
    expect(projectFinanceComparisonData(rows, USD.id).map(item => item.projectId)).toEqual([1, 3])
  })

  it('keeps null plans as unknown and still counts their actual spend', () => {
    const budget = projectBudgetHealthData([row(1, { finance: { ...row(1).finance, planned: null } }), row(2)], labels)
    expect(budget).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Unknown', value: 1 }),
      expect.objectContaining({ name: 'Within', value: 1 }),
    ]))
  })

  it('labels zero-task progress separately from measured zero percent and unavailable progress', () => {
    const data = projectProgressByProjectData([
      row(1, { task_count: 0, closed_task_count: 0, overdue_task_count: 0, progress: 0 }),
      row(2, { task_count: 4, closed_task_count: 0, overdue_task_count: 0, progress: 0 }),
      row(3, { task_count: null, closed_task_count: null, overdue_task_count: null, progress: null }),
    ], labels)
    expect(data.map(item => [item.value, item.progressState])).toEqual([[0, 'no_tasks'], [0, 'tracked'], [0, 'unknown']])
  })

  it('uses all projects and enables internal zoom when the project set is large', () => {
    const rows = Array.from({ length: 205 }, (_, index) => row(index + 1))
    const progress = projectProgressByProjectOption(rows, labels)
    const finance = projectFinanceComparisonOption(rows, SAR.id, labels)
    expect((progress.yAxis as { data: string[] }).data).toHaveLength(205)
    expect(progress.dataZoom).toHaveLength(2)
    expect(finance.xAxis).toMatchObject({ data: expect.arrayContaining(['Project 205']) })
    expect(finance.dataZoom).toHaveLength(2)
  })
})
