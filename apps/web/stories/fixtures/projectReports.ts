import { ProjectReportRowSchema, type ProjectReportRow } from '@liwan/contracts'
import {
  projectBudgetHealthChart,
  projectChartLabels,
  projectFinanceComparisonChart,
  projectProgressBandsChart,
  projectProgressByProjectChart,
  projectStatusDoughnutChart,
  projectTaskCompositionChart,
} from '../../app/utils/projectChartData'

const sar = { id: 1, name: 'Saudi Riyal', symbol: 'ر.س', decimal_places: 2 }
type Status = ProjectReportRow['project']['status']

function row(id: number, name: string, status: Status, tasks: number, closed: number, overdue: number, progress: number | null, planned: number | null, actual: number) {
  return {
    project: { id, name, status },
    finance: {
      project_id: id, currency: sar, charter_estimate: planned, planned, actual,
      remaining: planned === null ? null : planned - actual,
      utilization_percent: planned ? Math.round((actual / planned) * 100) : null,
      over_budget: planned !== null && actual > planned,
      budget_count: planned === null ? 0 : 1, expense_count: actual ? 3 : 0,
      actual_source: 'manual', actual_account: null, can_read_actual_lines: false, can_choose_actual_account: false,
    },
    task_count: tasks, closed_task_count: closed, overdue_task_count: overdue, progress,
  }
}

export const projectReportRows = ProjectReportRowSchema.array().parse([
  row(1, 'مشروع ألفا', 'on_track', 24, 12, 1, 50, 120000, 64000),
  row(2, 'تطوير البوابة', 'at_risk', 40, 18, 6, 45, 300000, 310000),
  row(3, 'التحول الرقمي', 'off_track', 16, 3, 5, 19, 80000, 20000),
  row(4, 'تحديث الأنظمة', 'on_hold', 10, 10, 0, 100, null, 0),
  row(5, 'برنامج التدريب', 'done', 8, 8, 0, 100, 50000, 48000),
  row(6, 'دراسة الجدوى', null, 0, 0, 0, null, null, 0),
])

export function dashboardCharts(t: (key: string) => string) {
  const labels = projectChartLabels(t)
  return {
    status: projectStatusDoughnutChart(projectReportRows, labels, t('projects.dashboard.charts.statusTitle')),
    tasks: projectTaskCompositionChart(projectReportRows, labels, t('projects.dashboard.charts.taskTitle')),
    progressBands: projectProgressBandsChart(projectReportRows, labels),
    budget: projectBudgetHealthChart(projectReportRows, labels, t('projects.dashboard.charts.budgetHealthTitle')),
    projectProgress: projectProgressByProjectChart(projectReportRows, labels),
    finance: projectFinanceComparisonChart(projectReportRows, sar.id, labels),
  }
}
