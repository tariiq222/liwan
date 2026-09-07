import { z } from 'zod'
import { CurrencyRefSchema } from './project-charter'

export const FinanceKindSchema = z.enum(['budget', 'expense'])
const amount = z.number().finite().nonnegative().max(1e12)
const date = z.iso.date()
const title = z.string().trim().min(1).max(200)
const reference = z.string().max(200)
const notes = z.string().max(10000)
const revision = z.string().regex(/^v\d+$/)
const link = z.number().int().positive().nullable()
const mutable = { title, amount, expense_date: date.nullable(), reference, notes, budget_entry_id: link }

export const FinanceEntryCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('budget'), title, amount, expense_date: z.null().optional(), reference: reference.optional(), notes: notes.optional(), budget_entry_id: z.null().optional() }).strict(),
  z.object({ kind: z.literal('expense'), title, amount: amount.positive(), expense_date: date, reference: reference.optional(), notes: notes.optional(), budget_entry_id: link.optional() }).strict(),
])
export const FinanceEntryPatchSchema = z.object(mutable).partial().extend({ expected_updated_at: revision }).strict().refine(value => Object.keys(value).some(key => key !== 'expected_updated_at'), { message: 'At least one mutable field is required' })
export const FinanceEntryDeleteSchema = z.object({ expected_updated_at: revision }).strict()
export const FinanceEntrySchema = z.object({
  id: z.number().int().positive(), project_id: z.number().int().positive(), kind: FinanceKindSchema,
  ...mutable, updated_at: revision,
}).strict()
export const FinanceSummarySchema = z.object({
  project_id: z.number().int().positive(), currency: CurrencyRefSchema,
  charter_estimate: z.number().finite().nonnegative().nullable(), planned: z.number().finite().nonnegative().nullable(),
  actual: z.number().finite().nonnegative(), remaining: z.number().finite().nullable(),
  utilization_percent: z.number().finite().nonnegative().nullable(), over_budget: z.boolean(),
  budget_count: z.number().int().nonnegative(), expense_count: z.number().int().nonnegative(),
}).strict()
export const FinanceEntryListSchema = z.object({ items: z.array(FinanceEntrySchema), total: z.number().int().nonnegative(), can_manage: z.boolean(), summary: FinanceSummarySchema }).strict()
export const FinanceDeletedSchema = z.object({ deleted: z.literal(true) }).strict()
export type FinanceKind = z.infer<typeof FinanceKindSchema>
export type FinanceEntryCreate = z.infer<typeof FinanceEntryCreateSchema>
export type FinanceEntryPatch = z.infer<typeof FinanceEntryPatchSchema>
export type FinanceEntry = z.infer<typeof FinanceEntrySchema>
export type FinanceSummary = z.infer<typeof FinanceSummarySchema>
export type FinanceEntryList = z.infer<typeof FinanceEntryListSchema>
