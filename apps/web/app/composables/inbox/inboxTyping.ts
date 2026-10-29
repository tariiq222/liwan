/**
 * Tells the customer's phone that the agent is typing: at most one call per interval while typing continues, and a
 * failure is ignored because the indicator is best effort (the server throttles and answers 204 either way).
 */
export function createTypingNotifier(send: () => Promise<unknown>, intervalMs = 3000, clock: () => number = Date.now) {
  let last = Number.NEGATIVE_INFINITY
  return function notifyTyping() {
    const now = clock()
    if (now - last < intervalMs) return
    last = now
    send().catch(() => undefined)
  }
}
