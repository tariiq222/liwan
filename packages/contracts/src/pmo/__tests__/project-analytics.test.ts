import { describe, expect, it } from 'vitest'
import { ProjectDashboardAnalyticsSchema } from '../project-reports'

const row = {
  project: { id: 10, name: 'Delivery', status: 'at_risk' as const },
  finance: {
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
  },
  task_count: 0,
  closed_task_count: 0,
  overdue_task_count: 0,
  progress: 0,
}

const summary = {
  project_count: 1,
  attention_project_count: 1,
  overdue_task_count: 0,
  status_counts: [{ status: 'at_risk' as const, count: 1 }],
  totals: [{
    currency: row.finance.currency,
    project_count: 1,
    budgeted_project_count: 1,
    planned: 100,
    actual: 120,
    remaining: -20,
    over_budget_count: 1,
  }],
  attention: [row],
}

describe('project dashboard analytics contract', () => {
  it('accepts all projects and at most five recent projects with UTC timestamps', () => {
    const payload = {
      ...summary,
      projects: [row],
      recent_projects: [{ ...row, updated_at: '2026-09-07T12:34:56Z' }],
    }
    expect(ProjectDashboardAnalyticsSchema.parse(payload)).toEqual(payload)
    expect(ProjectDashboardAnalyticsSchema.parse({
      ...payload,
      recent_projects: [{ ...row, updated_at: null }],
    }).recent_projects[0]?.updated_at).toBeNull()
  })

  it('rejects more than five recent projects, invalid dates and unknown fields', () => {
    const recent = Array.from({ length: 6 }, (_, index) => ({
      ...row,
      project: { ...row.project, id: index + 1 },
      updated_at: '2026-09-07T12:34:56Z',
    }))
    expect(() => ProjectDashboardAnalyticsSchema.parse({
      ...summary,
      projects: [row],
      recent_projects: recent,
    })).toThrow()
    expect(() => ProjectDashboardAnalyticsSchema.parse({
      ...summary,
      projects: [row],
      recent_projects: [{ ...row, updated_at: 'yesterday' }],
    })).toThrow()
    expect(() => ProjectDashboardAnalyticsSchema.parse({
      ...summary,
      projects: [row],
      recent_projects: [],
      unexpected: true,
    })).toThrow()
  })
})
