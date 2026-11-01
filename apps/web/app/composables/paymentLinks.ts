import type { FinanceInvoice } from '@liwan/contracts'
import { errorKeyFor } from './paymentErrors'

/** What decides whether a payment link can be offered for a document. */
export type PaymentLinkInvoice = Pick<FinanceInvoice, 'id' | 'move_type' | 'state' | 'payment_state' | 'amount_residual'>

/** A posted customer invoice with something left to pay. The server has the last word and refuses the rest with `not_payable`. */
export function canOfferPaymentLink(invoice: PaymentLinkInvoice | null | undefined): boolean {
  return invoice?.move_type === 'out_invoice' && invoice.state === 'posted' && invoice.payment_state !== 'paid' && invoice.amount_residual > 0
}

/** The address the customer opens: the link's path on the origin the staff member is browsing, which is the tenant's public origin. */
export function paymentLinkUrl(origin: string, path: string): string {
  return `${origin}${path}`
}

const LINK_ERROR_KEYS: Readonly<Record<string, string>> = {
  not_payable: 'payments.link.errors.notPayable',
  no_gateway: 'payments.link.errors.noGateway',
  link_access_required: 'payments.link.errors.accessRequired',
}

/** The locale key of a refused link this page words itself, or null to show the API's own text. */
export function paymentLinkErrorKey(error: unknown): string | null {
  return errorKeyFor(error, LINK_ERROR_KEYS)
}
