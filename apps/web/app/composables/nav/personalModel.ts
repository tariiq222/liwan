import { activeManifests } from '../../modules/manifests'
import type { AppPersonalEntry, PersonalSection } from '../../modules/types'
import { canReach, canReachPath, personalIdentity, type AccessIdentity } from '../../utils/accessPolicy'
import type { ShellContextLink } from './shellModules'

const ORDER: readonly PersonalSection[] = ['profile', 'leave', 'requests', 'pay', 'assets', 'documents', 'schedule']

/** The identity an entry is judged by: the home company's capabilities only for an entry the server serves from there. */
const identityFor = (entry: AppPersonalEntry, account: AccessIdentity) => entry.servedFromHomeCompany ? personalIdentity(account) : account

/** Visibility is evaluated before any summary query is constructed. */
export function personalEntries(account: AccessIdentity): AppPersonalEntry[] {
  return activeManifests().flatMap(manifest => manifest.personal ?? []).filter((entry) => {
    const identity = identityFor(entry, account)
    return canReach(identity, entry.capability, entry.to, entry.feature)
      && canReachPath(identity, entry.to)
      && (entry.requiredCapabilities ?? []).every(key => canReach(identity, key))
  }).sort((a, b) => ORDER.indexOf(a.section) - ORDER.indexOf(b.section))
}

export function personalContextLinks(identity: AccessIdentity): ShellContextLink[] {
  return [
    { id: 'personal-overview', labelKey: 'account.overview', icon: 'i-lucide-layout-dashboard', to: '/account', capability: 'liwan.internal', exact: true },
    ...personalEntries(identity).map(entry => ({ id: `personal-${entry.section}`, labelKey: entry.labelKey, icon: entry.icon, to: entry.to, capability: entry.capability })),
    { id: 'personal-settings', labelKey: 'account.settings', icon: 'i-lucide-settings-2', to: '/account/settings', capability: 'liwan.internal' },
  ]
}

export function personalAction(entry: AppPersonalEntry, account: AccessIdentity) {
  const identity = identityFor(entry, account)
  const action = entry.primaryAction
  return action && canReach(identity, action.capability, action.to) && canReachPath(identity, action.to) ? action : null
}
