import type { SalesPublicQuotation } from '@liwan/contracts'
import { SALES_LIMITS } from '@liwan/contracts'

/** The quotation and access token a quote-page address names. */
export interface QuoteLink {
  id: number
  token: string
}

const QUOTE_ID = /^[1-9]\d{0,11}$/
const ACCESS_TOKEN = /^[\w-]{1,128}$/

/** The quotation and token of a quote-page address, or null when either is missing or not of the shape the server issues. */
export function quoteLinkOf(id: unknown, token: unknown): QuoteLink | null {
  if (typeof id !== 'string' || !QUOTE_ID.test(id)) return null
  if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null
  return { id: Number(id), token }
}

/** The path of one public route of the quotation a link names; the token travels in the query of a read, in the body of a write. */
export const quotePath = (link: QuoteLink, action = '') => `/api/v1/public/sales/quotations/${link.id}${action}`

/** The address that downloads the quotation as a PDF. */
export const quotePdfHref = (link: QuoteLink) => `${quotePath(link, '/pdf')}?access_token=${encodeURIComponent(link.token)}`

/** The HTTP status a failed call carries, or null for any other failure. */
function refusalStatus(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null
}

/** Whether a failed read says the link names no quotation: a wrong token, a wrong id and a withdrawn quotation all answer 404. */
export const isInvalidQuoteLink = (error: unknown): boolean => refusalStatus(error) === 404

const ANSWER_ERRORS: Readonly<Record<string, string>> = {
  answer_not_allowed: 'sales.quote.errors.answerNotAllowed',
  already_answered: 'sales.quote.errors.alreadyAnswered',
  quotation_expired: 'sales.quote.errors.expired',
  signature_required: 'sales.quote.errors.signatureRequired',
  signature_invalid: 'sales.quote.errors.signatureInvalid',
  branch_read_only: 'sales.quote.errors.readOnly',
  tenant_read_only: 'sales.quote.errors.readOnly',
  tenant_suspended: 'sales.quote.errors.readOnly',
  // The edge refuses an oversized body before the server sees it: only a signature can make an answer that large.
  payload_too_large: 'sales.quote.signatureTooLarge',
  rate_limited: 'sales.quote.errors.rateLimited',
}

/** The locale key that words a refused answer; any other failure reads as the generic one. */
export function quoteAnswerErrorKey(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
  return typeof code === 'string' && Object.hasOwn(ANSWER_ERRORS, code) ? ANSWER_ERRORS[code]! : 'sales.quote.errors.failed'
}

/** Whether a refusal says the quotation changed under the page (so it is read again): an answer or an expiry reached it first. */
export const quoteChanged = (error: unknown): boolean => refusalStatus(error) === 422 || isInvalidQuoteLink(error)

/** What the quote page tells the customer, from the quotation alone. */
export type QuoteView = 'open' | 'accepted' | 'declined' | 'confirmed' | 'cancelled' | 'expired' | 'notOffered'

export function quoteView(quote: SalesPublicQuotation): QuoteView {
  if (quote.state === 'cancelled') return 'cancelled'
  if (quote.answer === 'accepted') return 'accepted'
  if (quote.answer === 'declined') return 'declined'
  if (quote.state === 'confirmed') return 'confirmed'
  if (quote.expired) return 'expired'
  return quote.can_accept || quote.can_decline ? 'open' : 'notOffered'
}

/** The size of a base64 string once decoded. */
export function decodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.floor(base64.length * 3 / 4) - padding
}

/** Whether a drawn signature is small enough for the server (decoded, at most 48 KB). */
export const signatureFits = (base64: string): boolean => decodedBytes(base64) <= SALES_LIMITS.signatureBytes

/** The base64 body of a PNG data URL, without the `data:` prefix the server refuses. */
export const pngBase64 = (dataUrl: string): string => dataUrl.slice(dataUrl.indexOf(',') + 1)
