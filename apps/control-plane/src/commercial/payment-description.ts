// The attempt identity of a card payment that runs through a payment intent. The provider keeps the intent's description locked
// and copies it onto the payment, while the payment's `metadata` and `given_id` are chosen by the browser. So the description is
// the only field that can safely say which attempt a payment belongs to (docs/operations/moyasar-form-spike.md, U2).
const PREFIX = 'LiwanOS payment '
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The description of an intent: the one place that decides its shape. The attempt id is a random uuid, so it is its own nonce. */
export function buildAttemptDescription(attemptId: string): string {
  if (!ATTEMPT_ID.test(attemptId)) throw new Error('attempt id must be a lowercase uuid')
  return `${PREFIX}${attemptId}`
}

/** The attempt id a description names, or null when it is anything but exactly what `buildAttemptDescription` makes. */
export function parseAttemptDescription(description: unknown): string | null {
  if (typeof description !== 'string' || !description.startsWith(PREFIX)) return null
  const attemptId = description.slice(PREFIX.length)
  return ATTEMPT_ID.test(attemptId) ? attemptId : null
}
