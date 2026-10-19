import { z } from 'zod'
import { day, FinanceRefSchema, id, list } from './shared'

/**
 * `closed`: the year-end close posted its closing entry. `locked`: the fiscal-year lock date covers
 * the year end without a closing entry (locked in setup, or closed while it had no income or expense).
 */
export const FinanceFiscalYearStateSchema = z.enum(['open', 'locked', 'closed'])

/**
 * One fiscal year, named by the calendar year in which it ends. `result` is the net profit
 * (negative: loss) of the year's posted income and expense, without the closing entry itself.
 * `closing_entry` is the posted year-end entry of a closed year, null when none was needed.
 */
export const FinanceFiscalYearSchema = z.object({
  year: z.number().int(),
  date_from: day,
  date_to: day,
  state: FinanceFiscalYearStateSchema,
  result: z.number(),
  closing_entry: FinanceRefSchema.nullable(),
}).strict()

export const FinanceClosingBlockerCodeSchema = z.enum([
  'year_not_ended', 'has_drafts', 'previous_year_open', 'account_not_closable',
  'no_retained_earnings_account', 'no_general_journal',
])

export const FinanceClosingBlockerSchema = z.object({
  code: FinanceClosingBlockerCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
}).strict()

export const FinanceClosingLineSchema = z.object({
  account: z.object({ id, code: z.string(), name: z.string() }).strict(),
  debit: z.number().nonnegative(),
  credit: z.number().nonnegative(),
}).strict()

/** The year-end entry a close would create: P&L balances moved to the retained-earnings account. */
export const FinanceClosingPreviewSchema = z.object({
  year: z.number().int(),
  date_from: day,
  date_to: day,
  journal: FinanceRefSchema.nullable(),
  retained_earnings_account: z.object({ id, code: z.string(), name: z.string() }).strict().nullable(),
  lines: z.array(FinanceClosingLineSchema),
  total_debit: z.number().nonnegative(),
  total_credit: z.number().nonnegative(),
  result: z.number(),
  /** Why a close would be refused now, in the order the close reports them; empty when it can proceed. */
  blockers: z.array(FinanceClosingBlockerSchema),
}).strict()

export const FinanceFiscalYearListSchema = list(FinanceFiscalYearSchema)

export const FinanceClosingErrorCodeSchema = z.enum([
  'already_closed', 'period_locked', ...FinanceClosingBlockerCodeSchema.options,
])

export type FinanceFiscalYear = z.infer<typeof FinanceFiscalYearSchema>
export type FinanceClosingBlocker = z.infer<typeof FinanceClosingBlockerSchema>
export type FinanceClosingLine = z.infer<typeof FinanceClosingLineSchema>
export type FinanceClosingPreview = z.infer<typeof FinanceClosingPreviewSchema>
export type FinanceFiscalYearList = z.infer<typeof FinanceFiscalYearListSchema>
