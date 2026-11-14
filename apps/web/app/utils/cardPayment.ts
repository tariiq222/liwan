import { refusalCode, type KeyStore } from './subscription'

/**
 * The version of the card-saving consent text a customer sees on the pay page and next to the auto-renew switch. The text is
 * `subscription.cardConsent.text` in both locale files: changing either wording means a new version here, and
 * `cardConsent.test.ts` fails until the new version is recorded against the new wording.
 */
export const CARD_CONSENT_TEXT_VERSION = '2026-11-14'
export const CARD_CONSENT_KEY = 'subscription.cardConsent.text'

/** The publishable key the mock control plane serves: the provider's real form refuses it, so the page shows a labelled stand-in. */
export const STAND_IN_PUBLISHABLE_KEY = 'pk_stand_in'

export const payPath = (orderId: string): string => `/subscription/pay/${encodeURIComponent(orderId)}`

/**
 * What the server answers to a payment attempt: the card form's session (`formPaymentSessionSchema` in the commercial contracts,
 * which the composable parses it with; this layer imports no contract). The intent is fulfilled by the browser with the
 * publishable key only; the amount is the server's.
 */
export type CardFormSession = {
  attempt_id: string
  intent: { id: string; client_secret: string }
  publishable_key: string
  amount: { minor: number; currency: string; exponent: number }
  expires_at: string
}

/**
 * The pay page's canonical path for any spelling of it, or null when `path` is already canonical (or is not a pay path). The
 * edge's content-security exception for the provider form matches `/subscription/pay/<order>` case-sensitively, and the router
 * does not, so a differently cased address must be redirected rather than rendered.
 */
export function canonicalPayRedirect(path: string): string | null {
  const match = /^\/subscription\/pay\/([^/]+)(\/?)$/i.exec(path)
  if (!match) return null
  const canonical = `/subscription/pay/${match[1]}${match[2]}`
  return canonical === path ? null : canonical
}

/** The only body a payment attempt carries: how to pay, whether to keep the card, and the consent wording seen. Nothing about the card. */
export function paymentAttemptBody(saveCard: boolean): { method: 'form'; save_card: boolean; consent_text_version?: string } {
  return saveCard
    ? { method: 'form', save_card: true, consent_text_version: CARD_CONSENT_TEXT_VERSION }
    : { method: 'form', save_card: false }
}

/** The only body the auto-renew switch carries; the version is sent only when turning it on. */
export function autoRenewBody(enabled: boolean): { enabled: boolean; consent_text_version?: string } {
  return enabled ? { enabled, consent_text_version: CARD_CONSENT_TEXT_VERSION } : { enabled }
}

/** What the page does about a refused attempt request. */
export type PayRefusal = 'in_progress' | 'not_awaiting' | 'form_unavailable' | 'auto_renew_not_allowed' | 'forbidden' | 'not_found' | 'failed'
const REFUSALS: Record<string, PayRefusal> = {
  payment_in_progress: 'in_progress', payment_not_awaiting: 'not_awaiting', card_form_unavailable: 'form_unavailable',
  auto_renew_not_allowed: 'auto_renew_not_allowed', forbidden: 'forbidden', not_found: 'not_found',
}
export function payRefusal(cause: unknown): PayRefusal {
  const code = refusalCode(cause)
  if (code && REFUSALS[code]) return REFUSALS[code]
  const status = (cause as { statusCode?: number; status?: number } | null)
  const http = status?.statusCode ?? status?.status
  return http === 403 ? 'forbidden' : http === 404 ? 'not_found' : 'failed'
}

/** The form stops being usable at `expires_at`; a clock a little fast must not offer a dead form, so a small margin counts as expired. */
const EXPIRY_MARGIN_MS = 5_000
export const sessionMsLeft = (session: Pick<CardFormSession, 'expires_at'>, now = Date.now()): number => Date.parse(session.expires_at) - EXPIRY_MARGIN_MS - now

/** Provider failures that mean the form's intent can no longer be used: the page offers to start again instead of retyping into a dead form. */
export const DEAD_INTENT_FAILURES: ReadonlySet<string> = new Set(['intent_not_fulfillable', 'invalid_client_secret'])

export type FormLocale = 'ar' | 'en'
export type FormConfigContext = { element: HTMLElement; saveCard: boolean; locale: string; origin: string; description: string; onFailure: (failure: { type?: string }) => void }

/**
 * The provider form's options. The session decides everything about the payment: the intent locks amount, currency, description
 * and return address on the provider's side, and the form fulfils it with the publishable key only. The library insists on an
 * amount, a currency, a description and a callback address, so the page passes the session's amount and currency and neutral
 * placeholders; the provider ignores whatever the page says. 3-D Secure is never switched off. The only other field is the attempt id in `metadata`.
 */
export function moyasarFormConfig(session: CardFormSession, ctx: FormConfigContext) {
  const language: FormLocale = ctx.locale.startsWith('ar') ? 'ar' : 'en'
  return {
    element: ctx.element,
    language,
    use_payment_intent: true,
    payment_intent: { id: session.intent.id, client_secret: session.intent.client_secret },
    publishable_api_key: session.publishable_key,
    methods: ['creditcard'],
    supported_networks: ['mada', 'visa', 'mastercard'],
    credit_card: { save_card: ctx.saveCard },
    amount: session.amount.minor,
    currency: session.amount.currency,
    description: ctx.description,
    // The one thing the page adds: the attempt id, so the control plane can find a payment that never reported back. It is only a way to
    // find candidates; the provider keeps whatever the browser sends, so each candidate is verified in full on the server.
    metadata: { attempt_id: session.attempt_id },
    // Where the form sends the browser when the provider answers at once (a decline before any 3-D Secure step). The relay reads the
    // attempt and asks the provider; the 3-D Secure return uses the address the server locked into the intent.
    callback_url: `${ctx.origin}/api/commercial/payment-callback?attempt=${encodeURIComponent(session.attempt_id)}`,
    // The form accepts only promise-based callbacks: a plain function makes it refuse the whole configuration.
    on_failure: async (failure: { type?: string }) => { ctx.onFailure(failure) },
  }
}

/**
 * The package's stylesheet minus its two document-wide rules: it restyles `html` and `body`, which would change the whole
 * application while the pay page is open. Everything else is scoped to the form's own `#mysr` element.
 */
export function scopedFormCss(css: string): string {
  return css
    .replace(/(^|\})html,(div#mysr :host\{)/g, '$1$2')
    .replace(/(^|\})body\{[^}]*\}/g, '$1')
}

/** A tab remembers that the customer opened the card form for an order, so coming back unpaid reads as "did not go through". */
const startedKey = (orderId: string) => `liwan:pay:started:${orderId}`
export const markPaymentStarted = (store: KeyStore | null, orderId: string) => store?.setItem(startedKey(orderId), '1')
export const paymentWasStarted = (store: KeyStore | null, orderId: string): boolean => store?.getItem(startedKey(orderId)) === '1'
export const clearPaymentStarted = (store: KeyStore | null, orderId: string) => store?.removeItem(startedKey(orderId))
