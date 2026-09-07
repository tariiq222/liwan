import { describe, expect, it } from 'vitest'
import type { ProjectDashboardSummary, ProjectReportRow, ProjectReportTotals } from '@nasq/contracts'
import {
  projectDashboardBudgetBars,
  projectDashboardFinanceRows,
  projectDashboardProgress,
  projectDashboardStatusBars,
} from '../projectDashboard'
import { reportSummaryQuery } from '../../composables/useProjectReports'

const SAR = { id: 1, name: 'Saudi Riyal', symbol: 'ر.س', decimal_places: 2 }
const USD = { id: 2, name: 'US Dollar', symbol: '$', decimal_places: 2 }

function totals(overrides: Partial<ProjectReportTotals> = {}): ProjectReportTotals {
  return {
    currency: SAR,
    project_count: 1,
    budgeted_project_count: 1,
    planned: 100,
    actual: 40,
    remaining: 60,
    over_budget_count: 0,
    ...overrides,
  }
}

function reportRow(overrides: Partial<ProjectReportRow> = {}): ProjectReportRow {
  return {
    project: { id: 7, name: 'Website', status: 'on_track' },
    finance: {
      project_id: 7,
      currency: SAR,
      charter_estimate: 100,
      planned: 100,
      actual: 40,
      remaining: 60,
      utilization_percent: 40,
      over_budget: false,
      budget_count: 1,
      expense_count: 1,
    },
    task_count: 4,
    closed_task_count: 2,
    overdue_task_count: 0,
    progress: 50,
    ...overrides,
  }
}

describe('projectDashboardStatusBars', () => {
  it('keeps unset status visible and calculates a distribution percentage from all counts', () => {
    expect(projectDashboardStatusBars([
      { status: 'on_track', count: 2 },
      { status: null, count: 1 },
      { status: 'at_risk', count: 1 },
    ])).toEqual([
      { status: 'on_track', count: 2, percent: 50 },
      { status: null, count: 1, percent: 25 },
      { status: 'at_risk', count: 1, percent: 25 },
    ])
  })

  it('returns no bars for an empty or zero-count distribution instead of inventing a denominator', () => {
    expect(projectDashboardStatusBars([])).toEqual([])
    expect(projectDashboardStatusBars([{ status: null, count: 0 }])).toEqual([
      { status: null, count: 0, percent: 0 },
    ])
  })
})

describe('projectDashboardFinanceRows', () => {
  it('keeps currency groups independent and preserves actuals while marking no-budget amounts unknown', () => {
    expect(projectDashboardFinanceRows([
      totals({ currency: USD, project_count: 2, budgeted_project_count: 0, planned: 0, actual: 25, remaining: 0 }),
      totals({ currency: SAR, project_count: 1, budgeted_project_count: 1, planned: 100, actual: 120, remaining: -20, over_budget_count: 1 }),
    ])).toEqual([
      {
        currency: USD,
        projectCount: 2,
        budgetedProjectCount: 0,
        planned: null,
        actual: 25,
        remaining: null,
        overBudgetCount: 0,
        unknownBudgetProjectCount: 2,
        amountsKnown: false,
      },
      {
        currency: SAR,
        projectCount: 1,
        budgetedProjectCount: 1,
        planned: 100,
        actual: 120,
        remaining: -20,
        overBudgetCount: 1,
        unknownBudgetProjectCount: 0,
        amountsKnown: true,
      },
    ])
  })

  it('returns an empty collection for no totals', () => {
    expect(projectDashboardFinanceRows([])).toEqual([])
  })

  it('exposes partial budget coverage so status copy can stay scoped', () => {
    expect(projectDashboardFinanceRows([totals({ project_count: 3, budgeted_project_count: 2 })])[0]).toMatchObject({
      unknownBudgetProjectCount: 1,
      amountsKnown: true,
    })
  })
})

describe('projectDashboardBudgetBars', () => {
  it('scales planned and actual against the larger known amount', () => {
    expect(projectDashboardBudgetBars({ planned: 100, actual: 40 })).toEqual({ plannedPercent: 100, actualPercent: 40 })
    expect(projectDashboardBudgetBars({ planned: 100, actual: 150 })).toEqual({ plannedPercent: 66.7, actualPercent: 100 })
  })

  it('keeps an unknown plan unknown while retaining a known actual bar', () => {
    expect(projectDashboardBudgetBars({ planned: null, actual: 25 })).toEqual({ plannedPercent: null, actualPercent: 100 })
  })

  it('handles zero planned and actual values without dividing by zero', () => {
    expect(projectDashboardBudgetBars({ planned: 0, actual: 0 })).toEqual({ plannedPercent: 0, actualPercent: 0 })
  })
})

describe('projectDashboardProgress', () => {
  it('reports closed tasks against total tasks and preserves unavailable task counts', () => {
    expect(projectDashboardProgress(reportRow())).toEqual({ closed: 2, total: 4, percent: 50 })
    expect(projectDashboardProgress(reportRow({ task_count: null, closed_task_count: null, progress: null }))).toEqual({
      closed: null,
      total: null,
      percent: null,
    })
  })

  it('does not turn a zero-task project into an unknown or divide by zero', () => {
    expect(projectDashboardProgress(reportRow({ task_count: 0, closed_task_count: 0, progress: 0 }))).toEqual({
      closed: 0,
      total: 0,
      percent: 0,
    })
  })
})

describe('dashboard summary contract fixture', () => {
  it('allows a null overdue total so the UI can distinguish unavailable task access', () => {
    const summary: ProjectDashboardSummary = {
      project_count: 0,
      attention_project_count: 0,
      overdue_task_count: null,
      status_counts: [],
      totals: [],
      attention: [],
    }
    expect(summary.overdue_task_count).toBeNull()
  })

  it('sends only the summary filters and never pagination parameters', () => {
    expect(reportSummaryQuery({ q: '  portal  ', status: 'at_risk' })).toEqual({ q: 'portal', status: 'at_risk' })
    expect(reportSummaryQuery({ q: ' ', status: 'all' })).toEqual({ q: undefined, status: undefined })
  })
})
