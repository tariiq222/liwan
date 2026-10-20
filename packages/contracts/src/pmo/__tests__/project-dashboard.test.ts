import { describe, expect, it } from 'vitest'
import {
  ProjectDashboardSummarySchema,
  ProjectReportRowSchema,
  ProjectReportTotalsSchema,
} from '../project-reports'

const finance = {
  project_id: 10,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  charter_estimate: null,
  planned: 100,
  actual: 120,
  remaining: -20,
  utilization_percent: 120,
  over_budget: true,
  budget_count: 1,
  expense_count: 2,
  actual_source: 'manual',
  actual_account: null,
  can_read_actual_lines: false,
  can_choose_actual_account: false,
}

const row = {
  project: { id: 10, name: 'Delivery', status: 'at_risk' },
  finance,
  task_count: 5,
  closed_task_count: 2,
  overdue_task_count: 2,
  progress: 40,
}

describe('project dashboard summary contract', () => {
  it('accepts all summary sections and nullable task totals', () => {
    const summary = {
      project_count: 2,
      attention_project_count: 1,
      overdue_task_count: 2,
      status_counts: [
        { status: 'at_risk', count: 1 },
        { status: null, count: 1 },
      ],
      totals: [ProjectReportTotalsSchema.parse({
        currency: finance.currency,
        project_count: 2,
        budgeted_project_count: 1,
        planned: 100,
        actual: 120,
        remaining: -20,
        over_budget_count: 1,
      })],
      attention: [row],
    }
    expect(ProjectDashboardSummarySchema.parse(summary)).toEqual(summary)
    expect(ProjectDashboardSummarySchema.parse({
      ...summary,
      overdue_task_count: null,
      attention: [],
    }).overdue_task_count).toBeNull()
  })

  it('requires strict row, count and status shapes', () => {
    expect(ProjectReportRowSchema.parse(row)).toEqual(row)
    expect(() => ProjectDashboardSummarySchema.parse({
      project_count: -1,
      attention_project_count: 0,
      overdue_task_count: null,
      status_counts: [],
      totals: [],
      attention: [],
    })).toThrow()
    expect(() => ProjectDashboardSummarySchema.parse({
      project_count: 0,
      attention_project_count: 0,
      overdue_task_count: null,
      status_counts: [{ status: 'unknown', count: 1 }],
      totals: [],
      attention: [],
      extra: true,
    })).toThrow()
  })
})
