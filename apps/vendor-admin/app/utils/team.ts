// The team page's vocabulary: the roles and account shapes come from the contracts package,
// and this adds the mapping from a failed call to the locale key shown to the person.
import { VENDOR_ROLES, type AdminAccountItem, type AdminAccountStatus, type VendorRole } from '@webvue/commercial-contracts'
import { StepUpCancelled } from '../composables/useStepUp'

export type TeamRole = VendorRole

/** The control plane's account states: `enrolling` is an invitation not yet accepted. */
export type TeamAccountStatus = AdminAccountStatus

/** One row of the account list, exactly as the control plane's contract names it. */
export type TeamAccount = AdminAccountItem

export interface TeamInvitation {
  /** The one-time secret; it is shown once and never kept anywhere else. */
  token: string
  expiresAt: string
}

export const REASON_MIN = 3
export const REASON_MAX = 1000

/** Roles in the canonical order, without duplicates or unknown names. */
export const sortedRoles = (roles: readonly string[]): TeamRole[] => VENDOR_ROLES.filter(role => roles.includes(role))

export const reasonValid = (reason: string): boolean => {
  const length = reason.trim().length
  return length >= REASON_MIN && length <= REASON_MAX
}

/** Where a person opens the invitation: the secret travels in the fragment, which no server ever sees. */
export const invitationLink = (origin: string, token: string): string => `${origin}/enroll#${token}`

const CODE_KEYS: Record<string, string> = {
  last_owner: 'team.errors.lastOwner',
  conflict: 'team.errors.conflict',
  invalid: 'team.errors.invalid',
  forbidden: 'team.errors.forbidden',
  step_up_required: 'team.errors.stepUpRequired',
  rate_limited: 'team.errors.rateLimited',
  vendor_unavailable: 'team.errors.unavailable',
  admin_unavailable: 'team.errors.unavailable',
}

/** Which message a failed mutation shows. A cancelled step-up is not an error of the call itself. */
export function teamErrorKey(error: unknown): string {
  if (error instanceof StepUpCancelled) return 'team.errors.stepUpCancelled'
  const e = error as { statusCode?: number, response?: { status?: number }, data?: { code?: string } } | null
  const code = e?.data?.code
  if (code && code in CODE_KEYS) return CODE_KEYS[code]!
  const status = e?.statusCode ?? e?.response?.status
  if (status === 403) return CODE_KEYS.forbidden!
  if (status === 429) return CODE_KEYS.rate_limited!
  if (status === 422) return CODE_KEYS.invalid!
  if (status === 503) return CODE_KEYS.vendor_unavailable!
  return 'team.errors.generic'
}
