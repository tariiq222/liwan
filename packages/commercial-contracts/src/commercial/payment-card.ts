import { z } from 'zod'

/**
 * The wording of the card-saving consent the customer sees is versioned. The control plane stores only a version it knows, so a client
 * cannot record consent to a text that never existed. A new wording adds its version here and moves `CURRENT_CONSENT_TEXT_VERSION`;
 * the customer app keeps its own copy of the current version (it may not import this package) and a test there fails when the two differ.
 */
export const CURRENT_CONSENT_TEXT_VERSION = '2026-11-14'
export const ACCEPTED_CONSENT_TEXT_VERSIONS: readonly string[] = [CURRENT_CONSENT_TEXT_VERSION]
export const isAcceptedConsentTextVersion = (version: unknown): version is string => typeof version === 'string' && ACCEPTED_CONSENT_TEXT_VERSIONS.includes(version)

/** The version of the consent text a customer saw when asking for automatic renewal; the server records the moment itself. */
export const autoRenewRequestSchema = z.strictObject({
  enabled: z.boolean(),
  consent_text_version: z.string().min(1).max(64).optional(),
}).superRefine((request, ctx) => {
  if (request.enabled && !request.consent_text_version) ctx.addIssue({ code: 'custom', path: ['consent_text_version'], message: 'Enabling automatic renewal needs the consent text version' })
})
export type AutoRenewRequest = z.infer<typeof autoRenewRequestSchema>

/** The expiry a card carries: the month and year printed on it. */
export type CardExpiry = { exp_month: number; exp_year: number }

const RIYADH_OFFSET_MS = 3 * 3_600_000 // Riyadh is UTC+3 all year, with no daylight saving

/**
 * The single rule for card expiry: a card is valid through the last day of its expiry month in Riyadh time and expires at the first
 * instant of the next month there. The control plane charges and notifies by it; a client that shows a card's state follows it too.
 */
export function cardExpired(card: CardExpiry, now: Date): boolean {
  return now.getTime() >= Date.UTC(card.exp_year, card.exp_month, 1) - RIYADH_OFFSET_MS
}

/** The last day the card is valid, as a calendar date (`YYYY-MM-DD`). */
export function cardLastValidDate(card: CardExpiry): string {
  return new Date(Date.UTC(card.exp_year, card.exp_month, 0)).toISOString().slice(0, 10)
}
