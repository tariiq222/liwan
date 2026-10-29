import { ApiError } from '../composables/useApi'
import { TENANT_SUSPENDED } from './tenantSuspension'

// Domain-level 403s: the request was understood, the *action* is not allowed
// for this user. They must surface as a toast where they happen, never as a
// logout — only an expired/absent session should send the tab to /login.
// A read-only tenant (expired subscription, or a feature kept for reading only)
// refuses writes with `tenant_read_only` / `feature_not_included` while the session stays valid.
const AUTHORIZED_403_CODES = new Set(['transition_forbidden', 'status_forbidden', 'tenant_read_only', 'feature_not_included'])

/** A 403 that may mean the session ended, so `me` is worth re-checking; a suspension has its own path. */
export function isPossibleSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && !AUTHORIZED_403_CODES.has(error.code)
    && error.code !== TENANT_SUSPENDED
}

/** A signed-in user replaced by another one in the same tab: the first user's cached data must not be shown to the second. */
export function isDifferentUser(before: { id: number } | null | undefined, after: { id: number } | null | undefined): boolean {
  return Boolean(before && after && before.id !== after.id)
}
