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

/** POST /bank-statements: the journal must be a bank or cash journal of the current company. */
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

const importFile = {
  journal_id: id,
  /** The text of the CSV file (at most 2 MiB, 5000 rows). */
  content: z.string().min(1),
  delimiter: z.enum([',', ';', '\t', '|']).optional(),
  has_header: z.boolean().optional(),
  date_format: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYY/MM/DD', 'DD.MM.YYYY']).optional(),
  decimal_separator: z.enum(['.', ',']).optional(),
}

/** A column is named by its header, or by its position when the file has no header. Map `amount`, or `debit` with `credit`. */
export const FinanceBankImportMappingSchema = z.object({
  date: z.union([z.string(), z.number().int().nonnegative()]),
  payment_ref: z.union([z.string(), z.number().int().nonnegative()]),
  amount: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  debit: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  credit: z.union([z.string(), z.number().int().nonnegative()]).optional(),
}).strict()

/** POST /bank-statements/import/preview without `mapping`: the header, a sample and the columns it suggests. */
export const FinanceBankImportPreviewRequestSchema = z.object({
  ...importFile, mapping: FinanceBankImportMappingSchema.optional(),
}).strict()

/** POST /bank-statements/import: the opening balance plus the lines must be the closing balance. */
export const FinanceBankImportSchema = z.object({
  ...importFile,
  mapping: FinanceBankImportMappingSchema,
  name: text.min(1).optional(),
  balance_start: money,
  balance_end_real: money,
  skip_duplicates: z.boolean().optional(),
}).strict()

export const FinanceBankImportColumnsSchema = z.object({
  delimiter: z.string(),
  columns: z.array(z.string()),
  sample: z.array(z.array(z.string())),
  suggested_mapping: z.record(z.string(), z.string()),
  row_count: z.number().int().nonnegative(),
}).strict()

export const FinanceBankImportPreviewSchema = z.object({
  delimiter: z.string(),
  columns: z.array(z.string()),
  lines: z.array(z.object({
    row: z.number().int().positive(), date: day, payment_ref: z.string(), amount: z.number(),
    /** The journal already holds this line (same day, amount and reference). */
    duplicate: z.boolean(),
  }).strict()),
  errors: z.array(z.object({ row: z.number().int().positive(), field: z.enum(['date', 'amount']), message: z.string() }).strict()),
  summary: z.object({
    lines: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), total: z.number(),
    date_from: day.nullable(), date_to: day.nullable(),
  }).strict(),
}).strict()

/** PATCH /bank-statements/{id}: correct the name and the balances. */
export const FinanceBankStatementPatchSchema = z.object({
  name: text.min(1).optional(),
  balance_start: money.optional(),
  balance_end_real: money.optional(),
}).strict().refine(body => Object.keys(body).length > 0, 'no fields to update')

/** POST /bank-statements/{id}/auto-reconcile: without `apply` it only reports what it would do. */
export const FinanceBankAutoReconcileInputSchema = z.object({ apply: z.boolean().optional() }).strict()

export const FinanceBankAutoReconcileSchema = z.object({
  applied: z.boolean(),
  matched: z.array(z.object({ line_id: id, move_line_id: id, entry: z.string() }).strict()),
  /** Lines left to a person: several candidates, none, or refused by Odoo (`failed`, with `message`). */
  review: z.array(z.object({
    line_id: id,
    reason: z.enum(['ambiguous', 'no_match', 'failed']),
    candidates: z.array(id),
    message: z.string().optional(),
  }).strict()),
}).strict()

export type FinanceBankLine = z.infer<typeof FinanceBankLineSchema>
export type FinanceBankStatement = z.infer<typeof FinanceBankStatementSchema>
export type FinanceBankStatementDetail = z.infer<typeof FinanceBankStatementDetailSchema>
export type FinanceReconcileProposal = z.infer<typeof FinanceReconcileProposalSchema>
export type FinanceBankStatementCreate = z.infer<typeof FinanceBankStatementCreateSchema>
export type FinanceBankReconcile = z.infer<typeof FinanceBankReconcileSchema>
export type FinanceBankImportMapping = z.infer<typeof FinanceBankImportMappingSchema>
export type FinanceBankStatementPatch = z.infer<typeof FinanceBankStatementPatchSchema>
export type FinanceBankImport = z.infer<typeof FinanceBankImportSchema>
export type FinanceBankImportPreview = z.infer<typeof FinanceBankImportPreviewSchema>
export type FinanceBankImportColumns = z.infer<typeof FinanceBankImportColumnsSchema>
export type FinanceBankAutoReconcile = z.infer<typeof FinanceBankAutoReconcileSchema>
