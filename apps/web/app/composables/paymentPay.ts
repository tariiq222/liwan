import {
  encodePayReturn,
  PayDocumentKindSchema,
  PAY_RETURN_COOKIE,
  PAY_RETURN_COOKIE_PATH,
  PAY_RETURN_MAX_AGE_SECONDS,
  type PayableInvoice,
  type PayableOrder,
  type PayableStatus,
  type PayDocumentKind,
  type PaymentOption,
  type PaymentRedirect,
  type PaymentStart,
} from '@webvue/contracts'
import { errorKeyFor } from './paymentErrors'

/** The gateway page the browser must open, as the start answer describes it. */
export type GatewayRedirect = PaymentRedirect['redirect']

/** What the holder of a pay link reads: a customer invoice or an online order. */
export type PayableDocument = PayableInvoice | PayableOrder

/** The document (its kind and id) and access token a pay-page address names. */
export interface PayLink {
  kind: PayDocumentKind
  id: number
  token: string
}

const DOCUMENT_ID = /^[1-9]\d{0,11}$/
const ACCESS_TOKEN = /^[\w-]{1,128}$/

/** The kind a pay-page address names, or null for any other word. */
export function payKindOf(kind: unknown): PayDocumentKind | null {
  const parsed = PayDocumentKindSchema.safeParse(kind)
  return parsed.success ? parsed.data : null
}

/** The document and token of a pay-page address, or null when the kind is unknown or either of the others is missing or not of the shape the server issues. */
export function payLinkOf(kind: unknown, id: unknown, token: unknown): PayLink | null {
  const documentKind = payKindOf(kind)
  if (!documentKind) return null
  if (typeof id !== 'string' || !DOCUMENT_ID.test(id)) return null
  if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null
  return { kind: documentKind, id: Number(id), token }
}

/** Whether a failed read says the link names no payable document: a wrong token, a wrong id and an expired link all answer 404. */
export function isInvalidLink(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

/** The identity of one way to pay, for a choice control: provider and payment method together. */
export function optionKey(option: PaymentOption): string {
  return `${option.provider_id}:${option.method_id}`
}

/** The start request body: the amount, currency and payer always come from the document, so only the token and the choice travel. */
export function startBody(link: PayLink, option: PaymentOption): PaymentStart {
  return { access_token: link.token, provider_id: option.provider_id, payment_method_id: option.method_id }
}

/** The locale keys of the refusals of a start: the ones that name the document read under its kind. */
const startErrorKeys = (kind: PayDocumentKind): Readonly<Record<string, string>> => ({
  not_payable: `payments.pay.${kind}.errors.notPayable`,
  payment_unavailable: 'payments.pay.errors.unavailable',
  payment_in_progress: `payments.pay.${kind}.errors.inProgress`,
})

/** The locale key of a refused start this page words itself, or null for any other failure (the page then says it generically). */
export function startErrorKey(kind: PayDocumentKind, error: unknown): string | null {
  return errorKeyFor(error, startErrorKeys(kind))
}

/** The cookie string the pay page writes before it leaves: it carries the payer back to the status page from the gateway's return. */
export function payReturnCookie(link: PayLink, secure: boolean): string {
  return `${PAY_RETURN_COOKIE}=${encodePayReturn({ kind: link.kind, id: link.id, accessToken: link.token })}; Path=${PAY_RETURN_COOKIE_PATH}; Max-Age=${PAY_RETURN_MAX_AGE_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** The gateway's address; the browser is only ever sent to a web page, whatever the server's text says. */
export function gatewayUrl(redirect: GatewayRedirect): URL {
  const url = new URL(redirect.url)
  if (url.protocol !== 'https:') throw new Error('The gateway redirect must be a secure web address')
  return url
}

/** Where a `get` redirect navigates: the gateway's address with the fields as its query. */
export function redirectUrl(redirect: GatewayRedirect): string {
  const url = gatewayUrl(redirect)
  for (const [name, value] of Object.entries(redirect.fields)) url.searchParams.set(name, value)
  return url.toString()
}

/** How long the status page keeps re-reading a document that is not settled yet, and how often. */
export const PAY_POLL_INTERVAL_MS = 3000
export const PAY_POLL_WINDOW_MS = 60_000

/** The wait before the next re-read, or false to stop: only a document still waiting for its payment (payable right after the return, or processing) is re-read, and only while the window is open. */
export function pollDelay(status: PayableStatus | undefined, windowOpen: boolean): number | false {
  return windowOpen && (status === 'payable' || status === 'processing') ? PAY_POLL_INTERVAL_MS : false
}

/** What the status page tells the payer. `confirming`: the gateway's answer has not reached us yet. `notPaid`: it never came in the window. */
export type PayStatusView = 'paid' | 'processing' | 'confirming' | 'notPaid' | 'notPayable'

export function payStatusView(status: PayableStatus, windowOpen: boolean): PayStatusView {
  if (status === 'paid') return 'paid'
  if (status === 'processing') return 'processing'
  if (status === 'not_payable') return 'notPayable'
  return windowOpen ? 'confirming' : 'notPaid'
}

/** An amount with Latin digits and the currency's own number of decimals; the currency code is drawn beside it by the caller. */
export function formatPayAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' })
    .formatToParts(amount)
    .filter(part => part.type !== 'currency' && part.type !== 'literal')
    .map(part => part.value)
    .join('')
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})/

/** A due date as a long date with Latin digits, or the server's text unchanged when it is not a date. */
export function formatPayDate(value: string, locale: string): string {
  const match = DAY.exec(value)
  if (!match) return value
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  // Date.UTC rolls a month 13 or a day 45 over into the next year or month: a real calendar day reads back as it was written.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', calendar: 'gregory', numberingSystem: 'latn', timeZone: 'UTC' }).format(date)
}

/** A moment as a long date with the time of day, in the payer's own time zone and with Latin digits, or the server's text unchanged when it is not a moment. */
export function formatPayDateTime(value: string, locale: string): string {
  const moment = new Date(value)
  if (Number.isNaN(moment.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short', calendar: 'gregory', numberingSystem: 'latn' }).format(moment)
}

/** The date a pay page shows beside the number: when an invoice falls due (a day) or when an unpaid order expires (a moment). Null when the document has none. */
export function payDeadline(document: PayableDocument, locale: string): string | null {
  if ('expires_at' in document) return document.expires_at ? formatPayDateTime(document.expires_at, locale) : null
  return document.due_date ? formatPayDate(document.due_date, locale) : null
}
