import { z } from 'zod'
import { currency, day, FinanceRefSchema, id, list, money, text } from './shared'

export const FinanceBankLineSchema = z.object({
  id,
  date: day,
  payment_ref: z.string(),
  partner: FinanceRefSchema.nullable(),
  amount: z.number(),
  is_reconciled: z.boolean(),
  /** What is still to reconcile of the line. */
  amount_residual: z.number(),
}).strict()

export const FinanceBankStatementSchema = z.object({
  id,
  name: z.string(),
  date: day.nullable(),
  journal: FinanceRefSchema,
  currency,
  balance_start: z.number(),
  balance_end: z.number(),
  balance_end_real: z.number(),
  lines_count: z.number().int().nonnegative(),
}).strict()

export const FinanceBankStatementDetailSchema = FinanceBankStatementSchema.extend({
  lines: z.array(FinanceBankLineSchema),
}).strict()

export const FinanceBankStatementListSchema = list(FinanceBankStatementSchema)

/** An open journal item a statement line could be matched with; `exact` clears the line to the cent. */
export const FinanceReconcileProposalSchema = z.object({
  id,
  date: day,
  entry: z.string().nullable(),
  label: z.string(),
  partner: FinanceRefSchema.nullable(),
  account: FinanceRefSchema,
  amount_residual: z.number(),
  exact: z.boolean(),
}).strict()
export const FinanceReconcileProposalListSchema = list(FinanceReconcileProposalSchema)

const BankLineInputSchema = z.object({
  date: day,
  payment_ref: text.min(1),
  partner_id: id.nullable().optional(),
  amount: money.refine((value) => value !== 0, 'amount must not be zero'),
}).strict()

/** POST /bank-statements: the journal must be a bank journal of the current company. */
export const FinanceBankStatementCreateSchema = z.object({
  journal_id: id,
  date: day,
  name: text.min(1).optional(),
  balance_start: money.optional(),
  balance_end_real: money.optional(),
  lines: z.array(BankLineInputSchema).min(1).max(500),
}).strict()

/** POST /bank-statement-lines/{id}/reconcile: items to match and/or the account for the rest (not receivable, payable or liquidity). */
export const FinanceBankReconcileSchema = z.object({
  move_line_ids: z.array(id).refine((ids) => new Set(ids).size === ids.length, 'ids must be distinct').optional(),
  account_id: id.nullable().optional(),
  label: text.min(1).optional(),
}).strict().refine(
  (value) => (value.move_line_ids?.length ?? 0) > 0 || value.account_id != null,
  { message: 'move_line_ids or account_id is required' },
).refine(
  (value) => value.label === undefined || value.account_id != null,
  { message: 'label needs account_id' },
)

export type FinanceBankLine = z.infer<typeof FinanceBankLineSchema>
export type FinanceBankStatement = z.infer<typeof FinanceBankStatementSchema>
export type FinanceBankStatementDetail = z.infer<typeof FinanceBankStatementDetailSchema>
export type FinanceReconcileProposal = z.infer<typeof FinanceReconcileProposalSchema>
export type FinanceBankStatementCreate = z.infer<typeof FinanceBankStatementCreateSchema>
export type FinanceBankReconcile = z.infer<typeof FinanceBankReconcileSchema>
