import { z } from 'zod'
import { currency, day, FinanceRefSchema, id, list, money, text } from './shared'

export const FinanceBudgetStateSchema = z.enum(['draft', 'confirmed', 'cancelled'])
/** `debit` lines (expenses, assets) are read in the debit direction, `credit` lines (income, liabilities, equity) in the credit one. */
export const FinanceBudgetNatureSchema = z.enum(['debit', 'credit'])

export const FinanceBudgetSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  state: FinanceBudgetStateSchema,
  date_from: day,
  date_to: day,
  currency,
  line_count: z.number().int().nonnegative(),
}).strict()

export const FinanceBudgetLineSchema = z.object({
  id,
  account: FinanceRefSchema,
  nature: FinanceBudgetNatureSchema,
  analytic_account: FinanceRefSchema.nullable(),
  label: z.string(),
  date_from: day,
  date_to: day,
  /** Positive in the direction of the account's nature, in the company currency. */
  amount: z.number(),
}).strict()

export const FinanceBudgetDetailSchema = FinanceBudgetSchema.extend({
  lines: z.array(FinanceBudgetLineSchema),
}).strict()

export const FinanceBudgetListSchema = list(FinanceBudgetSchema)

const VarianceSchema = z.object({
  budget: z.number(),
  actual: z.number(),
  variance: z.number(),
  /** Variance over the budget, null when the budget is zero. */
  variance_percent: z.number().nullable(),
}).strict()

export const FinanceBudgetVsActualLineSchema = VarianceSchema.extend({
  id,
  account: FinanceRefSchema,
  nature: FinanceBudgetNatureSchema,
  analytic_account: FinanceRefSchema.nullable(),
  label: z.string(),
  date_from: day,
  date_to: day,
  /** Spending at or under the budget (debit) or earning at or over it (credit). */
  favorable: z.boolean(),
}).strict()

/** Debit and credit lines are never added together; `net` is the credit side less the debit side. */
export const FinanceBudgetVsActualSchema = z.object({
  budget: z.object({ id, name: z.string(), state: FinanceBudgetStateSchema }).strict(),
  date_from: day,
  date_to: day,
  currency,
  target_move: z.literal('posted'),
  lines: z.array(FinanceBudgetVsActualLineSchema),
  totals: z.object({
    debit: VarianceSchema,
    credit: VarianceSchema,
    net: z.object({ budget: z.number(), actual: z.number() }).strict(),
  }).strict(),
}).strict()

/** POST /budgets */
export const FinanceBudgetCreateSchema = z.object({
  name: text.min(1),
  description: text.optional(),
  date_from: day,
  date_to: day,
}).strict()

/** PATCH /budgets/<id>: a draft only. */
export const FinanceBudgetPatchSchema = FinanceBudgetCreateSchema.partial().strict()

/** POST /budgets/<id>/lines: the period defaults to the budget's. */
export const FinanceBudgetLineCreateSchema = z.object({
  account_id: id,
  amount: money.min(0),
  date_from: day.optional(),
  date_to: day.optional(),
  label: text.optional(),
  analytic_account_id: id.nullable().optional(),
}).strict()

/** PATCH /budgets/<id>/lines/<line_id>: a line of a draft budget. */
export const FinanceBudgetLinePatchSchema = FinanceBudgetLineCreateSchema.partial().strict()

export type FinanceBudget = z.infer<typeof FinanceBudgetSchema>
export type FinanceBudgetLine = z.infer<typeof FinanceBudgetLineSchema>
export type FinanceBudgetDetail = z.infer<typeof FinanceBudgetDetailSchema>
export type FinanceBudgetVsActual = z.infer<typeof FinanceBudgetVsActualSchema>
export type FinanceBudgetCreate = z.infer<typeof FinanceBudgetCreateSchema>
export type FinanceBudgetPatch = z.infer<typeof FinanceBudgetPatchSchema>
export type FinanceBudgetLineCreate = z.infer<typeof FinanceBudgetLineCreateSchema>
export type FinanceBudgetLinePatch = z.infer<typeof FinanceBudgetLinePatchSchema>
