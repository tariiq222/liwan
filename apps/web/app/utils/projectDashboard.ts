import type { ProjectReportRow, ProjectReportTotals, ProjectStatus } from '@nasq/contracts'

export type ProjectDashboardStatusCount = {
  status: ProjectStatus | null
  count: number
}

export type ProjectDashboardStatusBar = ProjectDashboardStatusCount & {
  percent: number
}

export type ProjectDashboardFinanceRow = {
  currency: ProjectReportTotals['currency']
  projectCount: number
  budgetedProjectCount: number
  planned: number | null
  actual: number
  remaining: number | null
  overBudgetCount: number
  unknownBudgetProjectCount: number
  amountsKnown: boolean
}

export type ProjectDashboardProgress = {
  closed: number | null
  total: number | null
  percent: number | null
}

export type ProjectDashboardBudgetBars = {
  plannedPercent: number | null
  actualPercent: number
}

/**
 * Add a readable percentage to each status count without hiding the null
 * (unset) status. Percentages are relative to the complete filtered project
 * set and are rounded to one decimal place for compact bar labels.
 */
export function projectDashboardStatusBars(
  statusCounts: readonly ProjectDashboardStatusCount[],
): ProjectDashboardStatusBar[] {
  const total = statusCounts.reduce((sum, item) => sum + item.count, 0)
  return statusCounts.map(item => ({
    ...item,
    percent: total > 0 ? Math.round((item.count / total) * 1000) / 10 : 0,
  }))
}

/**
 * Keep money grouped by its server-supplied currency. A zero budgeted count
 * means the server's zero placeholders are unknown amounts, while actual
 * spend remains a known value.
 */
export function projectDashboardFinanceRows(
  totals: readonly ProjectReportTotals[],
): ProjectDashboardFinanceRow[] {
  return totals.map(group => {
    const amountsKnown = group.budgeted_project_count > 0
    return {
      currency: group.currency,
      projectCount: group.project_count,
      budgetedProjectCount: group.budgeted_project_count,
      planned: amountsKnown ? group.planned : null,
      actual: group.actual,
      remaining: amountsKnown ? group.remaining : null,
      overBudgetCount: group.over_budget_count,
      unknownBudgetProjectCount: Math.max(0, group.project_count - group.budgeted_project_count),
      amountsKnown,
    }
  })
}

/**
 * Scale each known amount against the larger amount in one currency group.
 * A missing plan stays missing so the UI cannot imply a zero budget.
 */
export function projectDashboardBudgetBars(amounts: {
  planned: number | null
  actual: number
}): ProjectDashboardBudgetBars {
  const max = Math.max(amounts.planned ?? 0, amounts.actual)
  if (max === 0) return { plannedPercent: amounts.planned == null ? null : 0, actualPercent: 0 }
  return {
    plannedPercent: amounts.planned == null ? null : Math.round((amounts.planned / max) * 1000) / 10,
    actualPercent: Math.round((amounts.actual / max) * 1000) / 10,
  }
}

/**
 * Derive the compact closed-tasks/total-tasks explanation used by dashboard
 * cards and attention rows. Null stays null when task visibility is absent.
 */
export function projectDashboardProgress(
  row: Pick<ProjectReportRow, 'task_count' | 'closed_task_count' | 'progress'>,
): ProjectDashboardProgress {
  if (row.task_count == null || row.closed_task_count == null || row.progress == null) {
    return { closed: row.closed_task_count, total: row.task_count, percent: null }
  }
  return { closed: row.closed_task_count, total: row.task_count, percent: row.progress }
}
