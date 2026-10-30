import { FinanceZatcaSubmissionSchema, type FinanceZatcaSubmission } from '@liwan/contracts'

/** API error codes the Finance pages explain in the user's language; any other code shows the server's own message. */
const CODE_KEYS = {
  not_draft: 'notDraft',
  not_posted: 'notPosted',
  has_payments: 'hasPayments',
  invalid_state: 'invalidState',
  period_locked: 'periodLocked',
  missing_exchange_rate: 'missingExchangeRate',
  pdf_unavailable: 'pdfUnavailable',
  zatca_not_onboarded: 'zatcaNotOnboarded',
  zatca_not_applicable: 'zatcaNotApplicable',
  zatca_rejected: 'zatcaRejected',
  zatca_unavailable: 'zatcaUnavailable',
  zatca_local_error: 'zatcaLocalError',
  zatca_unauthorized: 'zatcaUnauthorized',
  zatca_mode_not_allowed: 'zatcaModeNotAllowed',
  amount_exceeds_residual: 'amountExceedsResidual',
  journal_currency_mismatch: 'journalCurrencyMismatch',
} as const

export function financeErrorKey(code: string): string | null {
  const key = (CODE_KEYS as Record<string, string>)[code]
  return key ? `financeDocuments.errors.${key}` : null
}

/** The submission a failed ZATCA call carries in `details.submission`, with ZATCA's own codes and messages. */
export function zatcaSubmissionFromDetails(details: Record<string, unknown> | undefined): FinanceZatcaSubmission | null {
  const parsed = FinanceZatcaSubmissionSchema.safeParse(details?.submission)
  return parsed.success ? parsed.data : null
}
