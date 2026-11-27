/**
 * Generic pre-logout / pre-company-switch session teardown registry.
 *
 * Applications (such as the telephony softphone) register cleanup handlers that must run before the server ends or
 * switches the session, while auth and shell composables import no application code (R3). An optional `restore`
 * callback re-syncs the surface when a company switch or sign-out fails after teardown already ran.
 */
export type SessionTeardownHandler = () => Promise<void> | void
export type SessionRestoreHandler = () => Promise<void> | void

export interface SessionTeardownEntry {
  teardown: SessionTeardownHandler
  restore?: SessionRestoreHandler
}

const entries = new Set<SessionTeardownEntry>()

/** Registers a teardown callback (or `{ teardown, restore }` entry) and returns an unsubscribe function. */
export function registerSessionTeardown(
  handler: SessionTeardownHandler | SessionTeardownEntry,
): () => void {
  const entry: SessionTeardownEntry = typeof handler === 'function' ? { teardown: handler } : handler
  entries.add(entry)
  return () => {
    entries.delete(entry)
  }
}

/** Whether any teardown handler is currently registered. */
export function hasSessionTeardown(): boolean {
  return entries.size > 0
}

/**
 * Runs every registered teardown handler concurrently, swallowing individual failures so sign-out or company switch
 * is never blocked by a timed-out or failing cleanup.
 */
export async function runSessionTeardown(): Promise<void> {
  if (entries.size === 0) return
  await Promise.allSettled([...entries].map(entry => Promise.resolve().then(() => entry.teardown())))
}

/**
 * Runs every registered restore callback concurrently, swallowing individual failures, so surfaces torn down before a
 * failed company switch or sign-out come back cleanly.
 */
export async function restoreSessionTeardown(): Promise<void> {
  const restorers = [...entries]
    .map(entry => entry.restore)
    .filter((restore): restore is SessionRestoreHandler => typeof restore === 'function')
  if (restorers.length === 0) return
  await Promise.allSettled(restorers.map(restore => Promise.resolve().then(() => restore())))
}
