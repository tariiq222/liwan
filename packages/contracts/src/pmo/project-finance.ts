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
/** Where a project's actual comes from: its manual expenses, or the accounts another application keeps for it. */
export const ActualSourceSchema = z.enum(['manual', 'external'])
export const ActualAccountSchema = z.object({ id: z.number().int().positive(), name: z.string(), code: z.string().nullable() }).strict()
export const ActualLineSchema = z.object({
  id: z.number().int().positive(), date, label: z.string(), reference: z.string().nullable(),
  partner: z.object({ id: z.number().int().positive(), name: z.string() }).strict().nullable(),
  amount: z.number().finite(),
  record: z.object({ kind: z.string().min(1), id: z.number().int().positive() }).strict().nullable(),
}).strict()
export const ActualLineListSchema = z.object({ items: z.array(ActualLineSchema), total: z.number().int().nonnegative() }).strict()
export const ActualAccountPatchSchema = z.object({ account_id: z.number().int().positive().nullable() }).strict()
export const FinanceSummarySchema = z.object({
  project_id: z.number().int().positive(), currency: CurrencyRefSchema,
  charter_estimate: z.number().finite().nonnegative().nullable(), planned: z.number().finite().nonnegative().nullable(),
  actual: z.number().finite(), remaining: z.number().finite().nullable(),
  utilization_percent: z.number().finite().nullable(), over_budget: z.boolean(),
  budget_count: z.number().int().nonnegative(), expense_count: z.number().int().nonnegative(),
  actual_source: ActualSourceSchema, actual_account: ActualAccountSchema.nullable(),
  can_read_actual_lines: z.boolean(), can_choose_actual_account: z.boolean(),
}).strict()
export const FinanceEntryListSchema = z.object({ items: z.array(FinanceEntrySchema), total: z.number().int().nonnegative(), can_manage: z.boolean(), summary: FinanceSummarySchema }).strict()
export const FinanceDeletedSchema = z.object({ deleted: z.literal(true) }).strict()
export type FinanceKind = z.infer<typeof FinanceKindSchema>
export type FinanceEntryCreate = z.infer<typeof FinanceEntryCreateSchema>
export type FinanceEntryPatch = z.infer<typeof FinanceEntryPatchSchema>
export type FinanceEntry = z.infer<typeof FinanceEntrySchema>
export type FinanceSummary = z.infer<typeof FinanceSummarySchema>
export type FinanceEntryList = z.infer<typeof FinanceEntryListSchema>
export type ActualSource = z.infer<typeof ActualSourceSchema>
export type ActualAccount = z.infer<typeof ActualAccountSchema>
export type ActualLine = z.infer<typeof ActualLineSchema>
export type ActualLineList = z.infer<typeof ActualLineListSchema>
export type ActualAccountPatch = z.infer<typeof ActualAccountPatchSchema>
