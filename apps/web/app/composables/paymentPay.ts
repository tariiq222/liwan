import {
  encodePayReturn,
  PAY_RETURN_COOKIE,
  PAY_RETURN_COOKIE_PATH,
  PAY_RETURN_MAX_AGE_SECONDS,
  type PayableInvoiceStatus,
  type PaymentOption,
  type PaymentRedirect,
  type PaymentStart,
} from '@webvue/contracts'
import { errorKeyFor } from './paymentErrors'

/** The gateway page the browser must open, as the start answer describes it. */
export type GatewayRedirect = PaymentRedirect['redirect']

/** The invoice and access token a pay-page address names. */
export interface PayLink {
  id: number
  token: string
}

const INVOICE_ID = /^[1-9]\d{0,11}$/
const ACCESS_TOKEN = /^[\w-]{1,128}$/

/** The invoice and token of a pay-page address, or null when either is missing or not of the shape the server issues. */
export function payLinkOf(id: unknown, token: unknown): PayLink | null {
  if (typeof id !== 'string' || !INVOICE_ID.test(id)) return null
  if (typeof token !== 'string' || !ACCESS_TOKEN.test(token)) return null
  return { id: Number(id), token }
}

/** Whether a failed read says the link names no payable invoice: a wrong token, a wrong id and an expired link all answer 404. */
export function isInvalidLink(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404
}

/** The identity of one way to pay, for a choice control: provider and payment method together. */
export function optionKey(option: PaymentOption): string {
  return `${option.provider_id}:${option.method_id}`
}

/** The start request body: the amount, currency and payer always come from the invoice, so only the token and the choice travel. */
export function startBody(link: PayLink, option: PaymentOption): PaymentStart {
  return { access_token: link.token, provider_id: option.provider_id, payment_method_id: option.method_id }
}

const START_ERROR_KEYS: Readonly<Record<string, string>> = {
  not_payable: 'payments.pay.errors.notPayable',
  payment_unavailable: 'payments.pay.errors.unavailable',
}

/** The locale key of a refused start this page words itself, or null for any other failure (the page then says it generically). */
export function startErrorKey(error: unknown): string | null {
  return errorKeyFor(error, START_ERROR_KEYS)
}

/** The cookie string the pay page writes before it leaves: it carries the payer back to the status page from the gateway's return. */
export function payReturnCookie(link: PayLink, secure: boolean): string {
  return `${PAY_RETURN_COOKIE}=${encodePayReturn(link.id, link.token)}; Path=${PAY_RETURN_COOKIE_PATH}; Max-Age=${PAY_RETURN_MAX_AGE_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`
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

/** How long the status page keeps re-reading an invoice that is not settled yet, and how often. */
export const PAY_POLL_INTERVAL_MS = 3000
export const PAY_POLL_WINDOW_MS = 60_000

/** The wait before the next re-read, or false to stop: only an invoice still waiting for its payment (payable right after the return, or processing) is re-read, and only while the window is open. */
export function pollDelay(status: PayableInvoiceStatus | undefined, windowOpen: boolean): number | false {
  return windowOpen && (status === 'payable' || status === 'processing') ? PAY_POLL_INTERVAL_MS : false
}

/** What the status page tells the payer. `confirming`: the gateway's answer has not reached us yet. `notPaid`: it never came in the window. */
export type PayStatusView = 'paid' | 'processing' | 'confirming' | 'notPaid' | 'notPayable'

export function payStatusView(status: PayableInvoiceStatus, windowOpen: boolean): PayStatusView {
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
