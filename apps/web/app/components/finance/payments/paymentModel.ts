import type { FinanceInvoiceDetail, FinancePayment, FinancePaymentRegister, FinancePaymentStandalone } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import { invoiceKindOf } from '../invoices/invoiceKinds'
import { queryText, queryDay } from '../../../utils/routeQuery'

export const PAYMENTS_PATH = '/finance/payments'
export const PAYMENT_PAGE_SIZE = 25
export const PAYMENT_TYPES = ['inbound', 'outbound'] as const satisfies readonly FinancePayment['payment_type'][]
export const PAYMENT_STATES = ['draft', 'in_process', 'paid', 'canceled', 'rejected'] as const satisfies readonly FinancePayment['state'][]
/** More ids than this in the link are ignored: a payment settles a handful of documents, not a list. */
export const MAX_PREFILLED_INVOICES = 20

export const PAYMENT_STATE_TONE: Record<FinancePayment['state'], StatusTone> = {
  draft: 'neutral',
  in_process: 'info',
  paid: 'success',
  canceled: 'neutral',
  rejected: 'destructive',
}

type Query = Record<string, unknown>

export interface PaymentListFilters {
  q: string
  paymentType: FinancePayment['payment_type'] | null
  state: FinancePayment['state'] | null
  partnerId: number | null
  dateFrom: string | null
  dateTo: string | null
  page: number
}

export function paymentFiltersFromQuery(query: Query): PaymentListFilters {
  const type = queryText(query.payment_type)
  const state = queryText(query.state)
  const partner = Number(queryText(query.partner_id))
  const page = Number(queryText(query.page))
  const dateFrom = queryDay(query.date_from)
  const dateTo = queryDay(query.date_to)
  return {
    q: queryText(query.q) ?? '',
    paymentType: PAYMENT_TYPES.find(value => value === type) ?? null,
    state: PAYMENT_STATES.find(value => value === state) ?? null,
    partnerId: Number.isSafeInteger(partner) && partner > 0 ? partner : null,
    dateFrom,
    dateTo: !dateFrom || !dateTo || dateFrom <= dateTo ? dateTo : null,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  }
}

export function paymentActiveFilterCount(filters: PaymentListFilters): number {
  return Number(!!filters.q) + Number(!!filters.paymentType) + Number(!!filters.state) + Number(!!filters.partnerId) + Number(!!filters.dateFrom) + Number(!!filters.dateTo)
}

export function paymentListParams(filters: PaymentListFilters) {
  return {
    ...(filters.paymentType ? { payment_type: filters.paymentType } : {}),
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.partnerId ? { partner_id: filters.partnerId } : {}),
    ...(filters.dateFrom ? { date_from: filters.dateFrom } : {}),
    ...(filters.dateTo ? { date_to: filters.dateTo } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: PAYMENT_PAGE_SIZE,
    offset: (filters.page - 1) * PAYMENT_PAGE_SIZE,
  }
}

/** `?invoice_ids=3,5` of the register-payment link: positive ids, each once, in order. */
export function prefilledInvoiceIds(value: unknown): number[] {
  const raw = queryText(value)
  if (!raw) return []
  const ids = raw.split(',').map(part => Number(part.trim())).filter(id => Number.isSafeInteger(id) && id > 0)
  return [...new Set(ids)].slice(0, MAX_PREFILLED_INVOICES)
}

export function registerPaymentLink(invoiceIds: readonly number[], returnTo?: string) {
  return { path: `${PAYMENTS_PATH}/new`, query: { invoice_ids: invoiceIds.join(','), ...(returnTo ? { returnTo } : {}) } }
}

export type PayableInvoice = Pick<FinanceInvoiceDetail, 'id' | 'name' | 'move_type' | 'state' | 'partner' | 'currency' | 'amount_residual'>
export type BatchProblem = 'not_posted' | 'nothing_due' | 'partner' | 'currency' | 'type'

/** Why these documents cannot be paid by one payment (the server refuses the same cases), or null. */
export function paymentBatchProblem(invoices: readonly PayableInvoice[]): BatchProblem | null {
  if (invoices.some(invoice => invoice.state !== 'posted')) return 'not_posted'
  if (invoices.some(invoice => !(invoice.amount_residual > 0))) return 'nothing_due'
  if (new Set(invoices.map(invoice => invoice.partner?.id ?? 0)).size > 1) return 'partner'
  if (new Set(invoices.map(invoice => invoice.currency)).size > 1) return 'currency'
  if (new Set(invoices.map(invoice => invoice.move_type)).size > 1) return 'type'
  return null
}

export function paymentDue(invoices: readonly PayableInvoice[]): number {
  return Math.round(invoices.reduce((sum, invoice) => sum + invoice.amount_residual, 0) * 100) / 100
}

/** The direction of the money for these documents; null when the batch mixes types. */
export function paymentDirection(invoices: readonly PayableInvoice[]): FinancePayment['payment_type'] | null {
  const kinds = new Set(invoices.map(invoice => invoiceKindOf(invoice.move_type)?.direction))
  return kinds.size === 1 ? ([...kinds][0] ?? null) : null
}

export interface PaymentDraft {
  amount: string
  paymentDate: string | null
  journalId: number | null
  memo: string
}

export type PaymentErrors = Partial<Record<'amount' | 'paymentDate' | 'journalId', 'required' | 'exceeds'>>

export function validatePaymentDraft(draft: PaymentDraft, due: number): PaymentErrors {
  const amount = draft.amount.trim() === '' ? Number.NaN : Number(draft.amount)
  return {
    ...(!(Number.isFinite(amount) && amount > 0) ? { amount: 'required' as const } : amount > due + 0.005 ? { amount: 'exceeds' as const } : {}),
    ...(draft.paymentDate ? {} : { paymentDate: 'required' as const }),
    ...(draft.journalId ? {} : { journalId: 'required' as const }),
  }
}

export function buildPaymentRegister(invoiceIds: readonly number[], draft: PaymentDraft): FinancePaymentRegister {
  return {
    invoice_ids: [...invoiceIds],
    amount: Number(draft.amount),
    payment_date: draft.paymentDate!,
    journal_id: draft.journalId!,
    ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
  }
}

export interface StandalonePaymentDraft extends PaymentDraft {
  paymentType: FinancePayment['payment_type']
  partnerType: FinancePayment['partner_type']
  partnerId: number | null
}

/** A receipt is from a customer and a payment to a vendor; the refund of an advance flips the party, not the direction. */
export function defaultPartnerType(paymentType: FinancePayment['payment_type']): FinancePayment['partner_type'] {
  return paymentType === 'inbound' ? 'customer' : 'supplier'
}

export function validateStandaloneDraft(draft: StandalonePaymentDraft): PaymentErrors & { partnerId?: 'required' } {
  return {
    ...validatePaymentDraft(draft, Number.POSITIVE_INFINITY),
    ...(draft.partnerId ? {} : { partnerId: 'required' as const }),
  }
}

export function buildStandalonePayment(draft: StandalonePaymentDraft): FinancePaymentStandalone {
  return {
    payment_type: draft.paymentType,
    ...(draft.partnerType !== defaultPartnerType(draft.paymentType) ? { partner_type: draft.partnerType } : {}),
    partner_id: draft.partnerId!,
    amount: Number(draft.amount),
    payment_date: draft.paymentDate!,
    journal_id: draft.journalId!,
    ...(draft.memo.trim() ? { memo: draft.memo.trim() } : {}),
  }
}

export function standalonePaymentLink(returnTo?: string) {
  return { path: `${PAYMENTS_PATH}/new`, query: { kind: 'standalone', ...(returnTo ? { returnTo } : {}) } }
}

export function transferPaymentLink(returnTo?: string) {
  return { path: `${PAYMENTS_PATH}/transfer/new`, query: { ...(returnTo ? { returnTo } : {}) } }
}

/** The exchange gain or loss a settled payment produced, or null when it produced none. */
export function exchangeOutcome(payment: Pick<FinancePayment, 'exchange_difference'>): { kind: 'gain' | 'loss'; amount: number } | null {
  const difference = payment.exchange_difference
  if (difference === 0) return null
  return { kind: difference > 0 ? 'gain' : 'loss', amount: Math.abs(difference) }
}
