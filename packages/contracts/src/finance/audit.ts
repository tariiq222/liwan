import { z } from 'zod'
import { id, list } from './shared'

export const FinanceAuditActionSchema = z.enum([
  'account_created', 'account_changed', 'account_archived', 'account_unarchived',
  'zakat_adjustment_added', 'zakat_adjustment_removed', 'zakat_reviewed', 'asset_profile_created', 'asset_profile_changed', 'asset_profile_archived', 'asset_profile_unarchived', 'asset_changed', 'asset_deleted', 'asset_disposed', 'bank_statement_imported', 'bank_statement_changed', 'bank_statement_deleted', 'bank_line_unreconciled', 'bank_statement_auto_reconciled', 'payment_created', 'payment_changed', 'payment_posted', 'payment_allocated', 'payment_unallocated',
  'payment_cancelled', 'payment_reset_to_draft', 'asset_created', 'asset_validated', 'asset_depreciation_computed', 'bank_statement_created', 'bank_line_reconciled',
  'partner_created', 'partner_changed', 'partner_archived', 'partner_unarchived', 'analytic_plan_created', 'analytic_plan_changed', 'analytic_account_created', 'analytic_account_changed',
  'budget_created', 'budget_changed', 'budget_confirmed', 'budget_cancelled', 'budget_reset_to_draft', 'budget_line_created', 'budget_line_changed', 'budget_line_deleted', 'budget_lines_distributed',
  'invoice_created', 'invoice_changed', 'invoice_deleted', 'invoice_debit_note_created', 'invoice_credit_note_created', 'invoice_posted', 'invoice_cancelled', 'invoice_reset_to_draft',
  'entry_created', 'entry_changed', 'entry_deleted', 'entry_posted', 'entry_reset_to_draft', 'entry_unreconciled',
  'journal_created', 'journal_changed', 'journal_archived', 'journal_unarchived',
  'tax_created', 'tax_changed', 'tax_archived', 'tax_unarchived',
  'payment_term_created', 'payment_term_changed', 'payment_term_archived', 'payment_term_unarchived',
  'company_written', 'fiscal_year_closed', 'zatca_onboarded', 'zatca_submitted',
])

/** One immutable audit row: who (`actor`), when (`created_at`, ISO UTC), what, and the field names written, never values. */
export const FinanceAuditEventSchema = z.object({
  id,
  action: FinanceAuditActionSchema,
  actor: z.object({ id, name: z.string() }).strict(),
  created_at: z.string().datetime(),
  res_model: z.string(),
  res_id: z.number().int(),
  fields_written: z.array(z.string()),
  outcome: z.string().nullable(),
}).strict()

/**
 * GET /finance/audit-events (`action`, `date_from`, `date_to`, `limit`, `offset`). The two dates are days in the
 * user's timezone (else the company's, else UTC), both inclusive.
 */
export const FinanceAuditEventListSchema = list(FinanceAuditEventSchema)

export type FinanceAuditEvent = z.infer<typeof FinanceAuditEventSchema>
export type FinanceAuditEventList = z.infer<typeof FinanceAuditEventListSchema>
