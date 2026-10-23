import { activeManifests } from '../../modules/manifests'
import type { AppPersonalEntry, PersonalSection } from '../../modules/types'
import { canReach, canReachPath, type AccessIdentity } from '../../utils/accessPolicy'
import type { ShellContextLink } from './shellModules'

const ORDER: readonly PersonalSection[] = ['profile', 'leave', 'requests', 'pay', 'assets', 'documents', 'schedule']

/** Visibility is evaluated before any summary query is constructed. */
export function personalEntries(identity: AccessIdentity): AppPersonalEntry[] {
  return activeManifests().flatMap(manifest => manifest.personal ?? []).filter(entry =>
    canReach(identity, entry.capability, entry.to, entry.feature)
    && canReachPath(identity, entry.to)
    && (entry.requiredCapabilities ?? []).every(key => canReach(identity, key)),
  ).sort((a, b) => ORDER.indexOf(a.section) - ORDER.indexOf(b.section))
}

export function personalContextLinks(identity: AccessIdentity): ShellContextLink[] {
  return [
    { id: 'personal-overview', labelKey: 'account.overview', icon: 'i-lucide-layout-dashboard', to: '/account', capability: 'webvue.internal', exact: true },
    ...personalEntries(identity).map(entry => ({ id: `personal-${entry.section}`, labelKey: entry.labelKey, icon: entry.icon, to: entry.to, capability: entry.capability })),
    { id: 'personal-settings', labelKey: 'account.settings', icon: 'i-lucide-settings-2', to: '/account/settings', capability: 'webvue.internal' },
  ]
}

export function personalAction(entry: AppPersonalEntry, identity: AccessIdentity) {
  const action = entry.primaryAction
  return action && canReach(identity, action.capability, action.to) && canReachPath(identity, action.to) ? action : null
}
