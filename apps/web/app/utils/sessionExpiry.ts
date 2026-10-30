import { ApiError } from '../composables/useApi'

// A 403 is a domain-level refusal: the request was understood, the *action* is not allowed
// for this user (forbidden, a read-only tenant, a feature kept for reading, a suspension).
// It surfaces as a toast where it happens, never as a logout. Only a 401 (an expired or
// absent session) sends the tab to /login.

/** A 401: the session ended, so `me` is worth re-checking before routing to /login. */
export function isPossibleSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

/** A signed-in user replaced by another one in the same tab: the first user's cached data must not be shown to the second. */
export function isDifferentUser(before: { id: number } | null | undefined, after: { id: number } | null | undefined): boolean {
  return Boolean(before && after && before.id !== after.id)
}
