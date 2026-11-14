/**
 * What a declined card payment means for the next move. A soft decline may pass on a later day, a hard one never will (the card is
 * stopped), and a duplicate says an earlier payment with the same details may exist at the provider: it needs a lookup, never a retry.
 */
export type DeclineKind = 'soft' | 'hard' | 'duplicate'

/**
 * The gateway response codes (ISO 8583, field 39) a live payment carries in `source.response_code` (`00` is approved). One table, one
 * place. Only the standard codes whose meaning is certain are here; a code that is not listed falls to the message table below and then
 * to the soft default. Every entry names its category. The table must be checked against the provider's published list of gateway
 * response codes before live use (docs/operations/saas-commercial-runbook.md).
 */
const DECLINE_CODES: Readonly<Record<string, DeclineKind>> = {
  // lost, stolen, retained or fraud-flagged: the card is never charged again
  '04': 'hard', // pick up card (retained by the issuer)
  '07': 'hard', // pick up card, special condition (fraud)
  '33': 'hard', // expired card, retain
  '34': 'hard', // suspected fraud, retain
  '36': 'hard', // restricted card, retain
  '41': 'hard', // lost card
  '43': 'hard', // stolen card
  '59': 'hard', // suspected fraud
  // expired card, invalid card or account details
  '14': 'hard', // invalid card number
  '54': 'hard', // expired card
  // account closed or restricted
  '57': 'hard', // transaction not permitted to the cardholder
  '62': 'hard', // restricted card
  // insufficient funds and limits exceeded: may pass later
  '51': 'soft', // insufficient funds
  '61': 'soft', // exceeds withdrawal amount limit
  '65': 'soft', // exceeds withdrawal frequency limit
  // issuer or system unavailable, timeout, try again later
  '68': 'soft', // response received too late
  '91': 'soft', // issuer or switch inoperative
  '96': 'soft', // system malfunction
  // do not honour and generic decline
  '05': 'soft', // do not honour
  // duplicate transaction: an earlier payment may exist, look it up
  '94': 'duplicate', // duplicate transmission
}

/**
 * The messages the provider's sandbox returned for a failed payment (docs/operations/moyasar-form-spike.md, "Decline shapes"), in the
 * provider's own upper case. The sandbox payment carries no response code, so the message is the only signal there. A card that is lost, stolen
 * or expired will never pay, and a failure at the 3-D Secure step that the payer or the issuer decided (declined, rejected, service error, not
 * enrolled, not available for this card) stops the retries too. On the payment that saves a card such a failure leaves the token inactive. On
 * a charge of an already active token the token stays active (sandbox run of 2026-11-14), but a background charge has no payer to answer the
 * challenge, so a retry cannot pass either. `3DS: THE AUTHENTICATION IS UNAVAILABLE, PLEASE TRY AGAIN LATER` is the
 * issuer's own outage and is soft. Every other message (insufficient funds, a limit, a generic decline) can pass on a later day.
 */
const HARD_DECLINE_MESSAGES: ReadonlySet<string> = new Set([
  'DECLINED: LOST CARD',
  'DECLINED: STOLEN CARD',
  'DECLINED: EXPIRED CARD',
  '3DS: CARD AUTHENTICATION DECLINED.',
  '3DS: THE AUTHENTICATION ATTEMPT WAS REJECTED BY THE ISSUER BANK.',
  '3DS: SERVICE ERROR OCCURRED.',
  '3DS: THE CARD IS NOT ENROLLED IN 3DS SERVICE.',
  '3DS: ATTEMPTED BUT NOT AVAILABLE, PLEASE ENSURE THAT YOU HAVE ENABLED ONLINE PURCHASE FROM YOUR BANK PORTAL.',
  // Not observed in the sandbox: the well-known issuer phrases for a card that will never pay. `DO NOT HONOR` and `PICK UP CARD` are
  // soft or ambiguous by convention (the issuer often says it for a temporary hold) and stay soft.
  'DECLINED: RESTRICTED CARD',
  'DECLINED: SUSPECTED FRAUD',
  'DECLINED: CARD NOT PERMITTED',
  'DECLINED: INVALID CARD NUMBER',
  'DECLINED: CLOSED ACCOUNT',
])

const normalize = (message: string) => message.replace(/\s+/g, ' ').trim().toUpperCase()

/**
 * The response code decides when the provider gave one that is in the table; otherwise the message does. Anything unknown, or nothing at
 * all, is soft: a wrongly retried card costs one more failed try, a wrongly stopped one costs the renewal.
 */
export function classifyDecline(input: { code?: string | null; message?: string | null }): DeclineKind {
  const byCode = input.code ? DECLINE_CODES[input.code.trim()] : undefined
  if (byCode) return byCode
  return input.message && HARD_DECLINE_MESSAGES.has(normalize(input.message)) ? 'hard' : 'soft'
}
