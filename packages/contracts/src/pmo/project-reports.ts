import { z } from 'zod'
import { CurrencyRefSchema } from './project-charter'
import { FinanceSummarySchema } from './project-finance'
import { ProjectStatusSchema } from './project'
const count = z.number().int().nonnegative()
export const ProjectReportRowSchema = z.object({
  project: z.object({ id: z.number().int().positive(), name: z.string(), status: ProjectStatusSchema.nullable() }).strict(),
  finance: FinanceSummarySchema,
  task_count: count.nullable(), closed_task_count: count.nullable(), overdue_task_count: count.nullable(), progress: z.number().finite().min(0).max(100).nullable(),
}).strict()
export const ProjectReportTotalsSchema = z.object({
  currency: CurrencyRefSchema, project_count: count, budgeted_project_count: count,
  planned: z.number().finite().nonnegative(), actual: z.number().finite().nonnegative(), remaining: z.number().finite(), over_budget_count: count,
}).strict()
export const ProjectDashboardStatusCountSchema = z.object({ status: ProjectStatusSchema.nullable(), count }).strict()
export const ProjectDashboardSummarySchema = z.object({
  project_count: count,
  attention_project_count: count,
  overdue_task_count: count.nullable(),
  status_counts: z.array(ProjectDashboardStatusCountSchema),
  totals: z.array(ProjectReportTotalsSchema),
  attention: z.array(ProjectReportRowSchema),
}).strict()
export const ProjectDashboardAnalyticsSchema = ProjectDashboardSummarySchema.extend({
  projects: z.array(ProjectReportRowSchema),
  recent_projects: z.array(
    ProjectReportRowSchema.extend({ updated_at: z.string().datetime().nullable() }).strict(),
  ).max(5),
}).strict()
export type ProjectReportRow = z.infer<typeof ProjectReportRowSchema>
export type ProjectReportTotals = z.infer<typeof ProjectReportTotalsSchema>
export type ProjectDashboardStatusCount = z.infer<typeof ProjectDashboardStatusCountSchema>
export type ProjectDashboardSummary = z.infer<typeof ProjectDashboardSummarySchema>
export type ProjectDashboardAnalytics = z.infer<typeof ProjectDashboardAnalyticsSchema>
