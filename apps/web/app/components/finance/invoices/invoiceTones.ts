import type { FinanceInvoice, FinanceZatcaSubmission } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'

export const INVOICE_STATE_TONE: Record<FinanceInvoice['state'], StatusTone> = {
  draft: 'neutral',
  posted: 'success',
  cancel: 'destructive',
}

export const PAYMENT_STATE_TONE: Record<FinanceInvoice['payment_state'], StatusTone> = {
  not_paid: 'warning',
  in_payment: 'info',
  paid: 'success',
  partial: 'warning',
  reversed: 'neutral',
  blocked: 'destructive',
  invoicing_legacy: 'neutral',
}

export const ZATCA_STATE_TONE: Record<FinanceZatcaSubmission['state'], StatusTone> = {
  not_applicable: 'neutral',
  pending: 'info',
  retry: 'warning',
  rejected: 'destructive',
  blocked: 'destructive',
  unauthorized: 'destructive',
  accepted: 'success',
}
