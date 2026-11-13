// Relative imports: unit-tested directly under plain vitest.
import { SETUP_STEP_KEYS, type SetupProgress, type SetupStepKey } from '@liwan/contracts'
import { canReach, canReachPath, type AccessIdentity } from '../../utils/accessPolicy'
import { hasFeature } from '../../modules/registry'

/** Path of the wizard and the capability that opens it (the server's `settings.company.manage`, on the root company). */
export const SETUP_PATH = '/setup'

/**
 * Where a step's work lives: the page that owns it, the capability and feature that page needs. A step without a target
 * (`sector`: the owner decided against sector presets for now) offers only done and skip.
 */
interface SetupTarget { to: string; path: string; capability: string; feature?: string }
const TARGETS: Record<SetupStepKey, SetupTarget | null> = {
  company: { to: '/settings/company', path: '/settings/company', capability: 'settings.company.read' },
  sector: null,
  channels: { to: '/settings/apps/inbox?tab=channels#channels', path: '/settings/apps/inbox', capability: 'inbox.channels.manage', feature: 'inbox.enabled' },
  team: { to: '/settings/team/users', path: '/settings/team/users', capability: 'access.users.read' },
  contacts: { to: '/customers', path: '/customers', capability: 'customers.read', feature: 'customers.enabled' },
}

/** `open`: link to the page; `feature`: the tenant's plan does not include its application; `permission`: this user cannot open it; `none`: the step has no page. */
export type SetupTargetAccess = { kind: 'open'; to: string } | { kind: 'feature' | 'permission' | 'none' }

export function setupTargetAccess(identity: AccessIdentity, key: SetupStepKey): SetupTargetAccess {
  const target = TARGETS[key]
  if (!target) return { kind: 'none' }
  if (canReach(identity, target.capability, target.path, target.feature)) return { kind: 'open', to: target.to }
  return { kind: hasFeature(identity, target.feature ?? null) ? 'permission' : 'feature' }
}

/** Steps that already have an outcome, skipped counting as handled (the server's `complete` rule). */
export const handledSteps = (progress: SetupProgress): number => progress.steps.filter(step => step.outcome !== null).length
export const SETUP_STEP_COUNT = SETUP_STEP_KEYS.length

/** The home card shows while the wizard is open and the user may use its route. */
export const canUseSetup = (identity: AccessIdentity): boolean => canReachPath(identity, SETUP_PATH)
export const setupIsOpen = (progress: SetupProgress | undefined): progress is SetupProgress => progress !== undefined && progress.closed_at === null
