import type { FinanceInvoice, FinanceInvoiceDetail } from '@webvue/contracts'
import { invoiceKindOf } from './invoiceKinds'

type Can = (capability: string) => boolean
type ActionInvoice = Pick<FinanceInvoiceDetail, 'move_type' | 'state' | 'payment_state' | 'amount_residual' | 'debit_origin' | 'zatca'>

/** Payment states that mean a payment is reconciled with a posted document. */
const PAID_STATES: readonly FinanceInvoice['payment_state'][] = ['in_payment', 'paid', 'partial']
/** ZATCA states where the document still has to be sent for the first time. */
const FIRST_SEND_STATES = ['pending'] as const
/** ZATCA states that got no final verdict and are sent again after a fix or a wait. */
const RESEND_STATES = ['retry', 'rejected', 'blocked', 'unauthorized'] as const

export interface InvoiceActionSet {
  edit: boolean
  delete: boolean
  post: boolean
  resetToDraft: boolean
  cancel: boolean
  /** Cancel and reset are refused by the server while a payment is reconciled: the page explains instead of offering them. */
  blockedByPayments: boolean
  debitNote: boolean
  registerPayment: boolean
  pdf: boolean
  zatcaSubmit: boolean
  zatcaRetry: boolean
}

export function invoiceHasPayments(invoice: Pick<FinanceInvoice, 'state' | 'payment_state'>): boolean {
  return invoice.state === 'posted' && PAID_STATES.includes(invoice.payment_state)
}

/** What the record page offers: the document's state decides what is possible, the capabilities decide who may. */
export function invoiceActions(invoice: ActionInvoice, can: Can): InvoiceActionSet {
  const writable = invoiceKindOf(invoice.move_type) !== null
  const draft = invoice.state === 'draft'
  const posted = invoice.state === 'posted'
  const manage = writable && can('finance.invoices.manage')
  const post = writable && can('finance.invoices.post')
  const blockedByPayments = invoiceHasPayments(invoice)
  const zatcaState = invoice.zatca?.submission.state
  const zatcaMay = posted && can('finance.zatca.submit')
  return {
    edit: draft && manage,
    delete: draft && manage,
    post: draft && post,
    resetToDraft: !draft && post && !blockedByPayments,
    cancel: invoice.state !== 'cancel' && post && !blockedByPayments,
    blockedByPayments: blockedByPayments && post,
    debitNote: posted && manage && (invoice.move_type === 'out_invoice' || invoice.move_type === 'in_invoice') && !invoice.debit_origin,
    registerPayment: posted && writable && can('finance.payments.manage') && invoice.amount_residual > 0 && invoice.payment_state !== 'paid',
    pdf: posted && can('finance.invoices.read'),
    zatcaSubmit: zatcaMay && !!zatcaState && FIRST_SEND_STATES.some(state => state === zatcaState),
    zatcaRetry: zatcaMay && !!zatcaState && RESEND_STATES.some(state => state === zatcaState),
  }
}
