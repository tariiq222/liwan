/**
 * Generic pre-logout / pre-company-switch session teardown registry.
 *
 * Applications (such as the telephony softphone) register cleanup handlers that must run before the server ends or
 * switches the session, while auth and shell composables import no application code (R3).
 */
export type SessionTeardownHandler = () => Promise<void> | void

const handlers = new Set<SessionTeardownHandler>()

/** Registers a teardown callback and returns an unsubscribe function. */
export function registerSessionTeardown(handler: SessionTeardownHandler): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}

/** Whether any teardown handler is currently registered. */
export function hasSessionTeardown(): boolean {
  return handlers.size > 0
}

/**
 * Runs every registered teardown handler concurrently, swallowing individual failures so sign-out or company switch
 * is never blocked by a timed-out or failing cleanup.
 */
export async function runSessionTeardown(): Promise<void> {
  if (handlers.size === 0) return
  await Promise.allSettled([...handlers].map(handler => Promise.resolve().then(() => handler())))
}
