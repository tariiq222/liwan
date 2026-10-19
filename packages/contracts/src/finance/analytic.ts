import { z } from 'zod'
import { day, FinanceRefSchema, id, list, PATCH_MESSAGE, requirePatchField, text } from './shared'

export const FinanceAnalyticPlanSchema = z.object({
  id,
  name: z.string(),
  parent: FinanceRefSchema.nullable(),
}).strict()

export const FinanceAnalyticAccountRefSchema = z.object({
  id,
  name: z.string(),
  code: z.string(),
}).strict()

export const FinanceAnalyticAccountSchema = FinanceAnalyticAccountRefSchema.extend({
  plan: FinanceRefSchema,
  active: z.boolean(),
}).strict()

export const FinanceAnalyticPlanListSchema = list(FinanceAnalyticPlanSchema)
export const FinanceAnalyticAccountListSchema = list(FinanceAnalyticAccountSchema)

/** A plan is shared by every company of the database. Only the name can change afterwards. */
export const FinanceAnalyticPlanCreateSchema = z.object({
  name: text.trim().min(1),
  parent_id: id.nullable().optional(),
}).strict()

export const FinanceAnalyticPlanPatchSchema = FinanceAnalyticPlanCreateSchema.pick({ name: true }).partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

/** A cost center belongs to the current company. `active: false` archives it; there is no delete. */
export const FinanceAnalyticAccountCreateSchema = z.object({
  name: text.trim().min(1),
  code: text.optional(),
  plan_id: id,
  active: z.boolean().optional(),
}).strict()

export const FinanceAnalyticAccountPatchSchema = FinanceAnalyticAccountCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

/** One cost center's share of a document line, in percent. */
export const FinanceAnalyticShareSchema = z.object({
  account: FinanceAnalyticAccountRefSchema,
  percent: z.number(),
}).strict()

// A request object `{ "<account id>": percent }`: each percent is above 0 and at most 100, the percentages of one
// plan add up to at most 100 (the server answers 422 `invalid` on the line field). An absent key leaves the line to
// Odoo (its distribution models may apply); `{}` means explicitly no distribution.
export const FinanceAnalyticDistributionInputSchema = z.record(
  z.string().regex(/^[1-9]\d*$/),
  z.number().gt(0).max(100),
)

const reportAmounts = {
  income: z.number(),
  expense: z.number(),
  net: z.number(),
}

export const FinanceAnalyticReportRowSchema = z.object({
  account: FinanceAnalyticAccountRefSchema,
  plan: FinanceRefSchema,
  ...reportAmounts,
}).strict()

/** Income and expense per cost center from the posted analytic items, in the company currency. */
export const FinanceAnalyticReportSchema = z.object({
  date_from: day,
  date_to: day,
  currency: z.string().min(1),
  plan: FinanceRefSchema.nullable(),
  accounts: z.array(FinanceAnalyticReportRowSchema),
  totals: z.object(reportAmounts).strict(),
}).strict()

export const FinanceAnalyticReportLineSchema = z.object({
  id,
  date: day,
  name: z.string(),
  ref: z.string(),
  move: FinanceRefSchema.nullable(),
  general_account: FinanceRefSchema,
  partner: FinanceRefSchema.nullable(),
  kind: z.enum(['income', 'expense']),
  /** Positive for income (credit), negative for expense (debit). */
  amount: z.number(),
}).strict()

export const FinanceAnalyticReportLineListSchema = list(FinanceAnalyticReportLineSchema)

export type FinanceAnalyticPlan = z.infer<typeof FinanceAnalyticPlanSchema>
export type FinanceAnalyticAccountRef = z.infer<typeof FinanceAnalyticAccountRefSchema>
export type FinanceAnalyticAccount = z.infer<typeof FinanceAnalyticAccountSchema>
export type FinanceAnalyticPlanList = z.infer<typeof FinanceAnalyticPlanListSchema>
export type FinanceAnalyticAccountList = z.infer<typeof FinanceAnalyticAccountListSchema>
export type FinanceAnalyticPlanCreate = z.infer<typeof FinanceAnalyticPlanCreateSchema>
export type FinanceAnalyticPlanPatch = z.infer<typeof FinanceAnalyticPlanPatchSchema>
export type FinanceAnalyticAccountCreate = z.infer<typeof FinanceAnalyticAccountCreateSchema>
export type FinanceAnalyticAccountPatch = z.infer<typeof FinanceAnalyticAccountPatchSchema>
export type FinanceAnalyticShare = z.infer<typeof FinanceAnalyticShareSchema>
export type FinanceAnalyticDistributionInput = z.infer<typeof FinanceAnalyticDistributionInputSchema>
export type FinanceAnalyticReportRow = z.infer<typeof FinanceAnalyticReportRowSchema>
export type FinanceAnalyticReport = z.infer<typeof FinanceAnalyticReportSchema>
export type FinanceAnalyticReportLine = z.infer<typeof FinanceAnalyticReportLineSchema>
export type FinanceAnalyticReportLineList = z.infer<typeof FinanceAnalyticReportLineListSchema>
