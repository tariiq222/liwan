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
export const ProjectReportListSchema = z.object({ items: z.array(ProjectReportRowSchema), total: count, totals: z.array(ProjectReportTotalsSchema) }).strict()
export type ProjectReportRow = z.infer<typeof ProjectReportRowSchema>
export type ProjectReportTotals = z.infer<typeof ProjectReportTotalsSchema>
export type ProjectReportList = z.infer<typeof ProjectReportListSchema>
