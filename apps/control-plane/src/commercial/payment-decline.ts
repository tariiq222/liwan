/** Whether a declined saved-card charge is worth trying again: a soft decline may pass, a hard one never will. */
export type DeclineKind = 'soft' | 'hard'

/**
 * The messages the provider's sandbox returned for a failed payment (docs/operations/moyasar-form-spike.md, "Decline shapes"), in the
 * provider's own upper case. The sandbox payment carries no response code, so the message is the only signal. A card that is lost, stolen
 * or expired will never pay, and a failure at the 3-D Secure step leaves the token inactive: those stop the retries. Every other message
 * (insufficient funds, a limit, a generic decline) can pass on a later day.
 */
const HARD_DECLINE_MESSAGES: ReadonlySet<string> = new Set([
  'DECLINED: LOST CARD',
  'DECLINED: STOLEN CARD',
  'DECLINED: EXPIRED CARD',
  '3DS: CARD AUTHENTICATION DECLINED.',
  '3DS: THE AUTHENTICATION IS UNAVAILABLE, PLEASE TRY AGAIN LATER OR CONTACT ISSUER BANK IF PROBLEM PERSISTED.',
  '3DS: THE AUTHENTICATION ATTEMPT WAS REJECTED BY THE ISSUER BANK.',
  '3DS: SERVICE ERROR OCCURRED.',
  '3DS: THE CARD IS NOT ENROLLED IN 3DS SERVICE.',
  '3DS: ATTEMPTED BUT NOT AVAILABLE, PLEASE ENSURE THAT YOU HAVE ENABLED ONLINE PURCHASE FROM YOUR BANK PORTAL.',
])

const normalize = (message: string) => message.replace(/\s+/g, ' ').trim().toUpperCase()

/** A message that is not in the table above, or no message at all, is soft: a wrongly retried card costs one more failed try, a wrongly stopped one costs the renewal. */
export function classifyDecline(message: string | null | undefined): DeclineKind {
  return message && HARD_DECLINE_MESSAGES.has(normalize(message)) ? 'hard' : 'soft'
}
