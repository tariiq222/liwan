import { canReach, canReachPath, type AccessIdentity } from './accessPolicy'
import { manifestForPath } from '../modules/manifests'

/**
 * Why an application page is closed, as far as `/me` can tell. It cannot tell a trial that ended from an application the
 * plan never held (both are `feature_not_included`), so it never claims either: `not_in_plan` is worded for both.
 * `payment_suspended` needs `platform.state`, which the unpaid-invoice lock sets; any other read-only tenant is `read_only`.
 */
export type LockedCause = 'not_in_plan' | 'payment_suspended' | 'read_only' | 'not_enabled'
/** `non_saas` has no plans or payment, so manager and member get the same words. */
export type LockedAudience = 'manager' | 'member' | 'non_saas'

export interface LockedApplicationView {
  cause: LockedCause
  audience: LockedAudience
  /** The rail label key of the application the path belongs to, or null for a foundation path. */
  labelKey: string | null
  /** A page of the application the user can still read, or null when the application is not readable. */
  dataPath: string | null
}

type LockedIdentity = NonNullable<AccessIdentity> & { commercial?: { mode?: string } }

export function lockedApplicationView(
  identity: LockedIdentity,
  path: string,
  code: 'feature_not_included' | 'tenant_read_only',
  canManage: boolean,
): LockedApplicationView {
  const nonSaas = identity.commercial?.mode === 'non_saas'
  const cause: LockedCause = nonSaas ? 'not_enabled'
    : code === 'feature_not_included' ? 'not_in_plan'
      : identity.platform?.state === 'payment_suspended' ? 'payment_suspended' : 'read_only'
  const manifest = manifestForPath(path)
  const readable = !!manifest && (manifest.feature === null || identity.platform?.readable_features.includes(manifest.feature) === true)
  // The first landing the identity can really open, so "open existing data" never leads to another closed page.
  const landing = manifest && readable
    ? [...(manifest.landing ?? []).filter(entry => canReach(identity, entry.capability, entry.path) && canReachPath(identity, entry.path)).map(entry => entry.path), manifest.rail[0]?.to]
      .find((candidate): candidate is string => Boolean(candidate) && canReachPath(identity, candidate!))
    : undefined
  return {
    cause,
    audience: nonSaas ? 'non_saas' : canManage ? 'manager' : 'member',
    labelKey: manifest?.rail[0]?.labelKey ?? null,
    dataPath: landing ?? null,
  }
}
