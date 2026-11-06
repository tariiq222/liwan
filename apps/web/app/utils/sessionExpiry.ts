import { ApiError } from '../composables/useApi'

// A 403 is a domain-level refusal: the request was understood, the *action* is not allowed
// for this user (forbidden, a read-only tenant, a feature kept for reading, a suspension).
// It surfaces as a toast where it happens, never as a logout. Only a 401 (an expired or
// absent session) sends the tab to /login.

/** A 401: the session ended, so `me` is worth re-checking before routing to /login. */
export function isPossibleSessionExpiry(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

type SessionIdentity = { id: number, company: { id: number } }

/** One mounted private view belongs to one user and active company. */
export function sessionIdentityKey(identity: SessionIdentity | null | undefined): string {
  return identity ? `${identity.id}:${identity.company.id}` : 'anonymous'
}

/** Public and guest forms do not follow changes to an unrelated private session. */
export function sessionViewKey(identityKey: string, access: unknown): string {
  return access === 'public' || access === 'guest' ? 'public' : `private:${identityKey}`
}
