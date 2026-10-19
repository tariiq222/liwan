import { z } from 'zod'
import { FinanceAnalyticDistributionInputSchema, FinanceAnalyticShareSchema } from './analytic'
import { currency, day, FinanceRefSchema, id, list, money, PATCH_MESSAGE, requirePatchField, text } from './shared'

export const JournalEntrySchema = z.object({
  id,
  /** Null until a number is assigned. */
  name: z.string().nullable(),
  state: z.enum(['draft', 'posted', 'cancel']),
  date: day,
  ref: z.string(),
  journal: FinanceRefSchema,
  currency,
  amount_total: z.number(),
}).strict()

export const JournalEntryLineSchema = z.object({
  id,
  account: FinanceRefSchema,
  partner: FinanceRefSchema.nullable(),
  name: z.string(),
  debit: z.number(),
  credit: z.number(),
  analytic_distribution: z.array(FinanceAnalyticShareSchema),
}).strict()

export const JournalEntryDetailSchema = JournalEntrySchema.extend({
  lines: z.array(JournalEntryLineSchema),
}).strict()

export const JournalEntryListSchema = list(JournalEntrySchema)

// Exactly one of debit and credit is above zero on a line, and the lines balance (the server answers 422).
export const JournalEntryLineInputSchema = z.object({
  account_id: id,
  partner_id: id.nullable().optional(),
  name: text.trim().min(1),
  debit: money.nonnegative().optional(),
  credit: money.nonnegative().optional(),
  analytic_distribution: FinanceAnalyticDistributionInputSchema.optional(),
}).strict().refine(
  line => ((line.debit ?? 0) > 0) !== ((line.credit ?? 0) > 0),
  { message: 'Exactly one of debit or credit must be above zero' },
)

// A body that carries `lines` replaces every line of the draft; one without keeps them.
const lines = z.array(JournalEntryLineInputSchema).min(2)

export const JournalEntryCreateSchema = z.object({
  journal_id: id,
  date: day,
  ref: text.optional(),
  lines,
}).strict()

export const JournalEntryPatchSchema = JournalEntryCreateSchema.partial().strict()
  .refine(requirePatchField, PATCH_MESSAGE)

export type JournalEntry = z.infer<typeof JournalEntrySchema>
export type JournalEntryLine = z.infer<typeof JournalEntryLineSchema>
export type JournalEntryDetail = z.infer<typeof JournalEntryDetailSchema>
export type JournalEntryList = z.infer<typeof JournalEntryListSchema>
export type JournalEntryLineInput = z.infer<typeof JournalEntryLineInputSchema>
export type JournalEntryCreate = z.infer<typeof JournalEntryCreateSchema>
export type JournalEntryPatch = z.infer<typeof JournalEntryPatchSchema>
