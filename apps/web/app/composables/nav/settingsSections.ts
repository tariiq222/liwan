// Relative imports: unit-tested directly under plain vitest.
import { activeManifests } from '../../modules/manifests'
import type { AppIcon, AppSettingsEntry } from '../../modules/types'

export type SettingsSectionId = 'company' | 'team' | 'apps' | 'system' | 'billing'
export type SettingsEntry = AppSettingsEntry
export interface SettingsSection {
  id: SettingsSectionId
  /** Locale key of the section name: the link in the settings sidebar and the heading over its pages. */
  labelKey: string
  icon: AppIcon
  /** Path prefix that marks the section as open. */
  within: string
  entries: SettingsEntry[]
}

const COMPANY: SettingsEntry[] = [
  { id: 'profile', labelKey: 'settings.sections.company.profile', icon: 'i-lucide-building-2', to: '/settings/company/profile', capability: 'settings.company.read' },
  { id: 'address', labelKey: 'settings.sections.company.address', icon: 'i-lucide-map-pin', to: '/settings/company/address', capability: 'settings.company.read' },
  { id: 'contact', labelKey: 'settings.sections.company.contact', icon: 'i-lucide-phone', to: '/settings/company/contact', capability: 'settings.company.read' },
  { id: 'branding', labelKey: 'settings.sections.company.branding', icon: 'i-lucide-palette', to: '/settings/company/branding', capability: 'settings.branding.manage' },
]
const TEAM: SettingsEntry[] = [
  { id: 'users', labelKey: 'nav.users', icon: 'i-lucide-user-cog', to: '/settings/team/users', capability: 'access.users.read' },
  { id: 'roles', labelKey: 'nav.roles', icon: 'i-lucide-shield-check', to: '/settings/team/roles', capability: 'access.roles.read' },
  { id: 'access-log', labelKey: 'nav.accessLog', icon: 'i-lucide-history', to: '/settings/team/access-log', capability: 'access.audit.read' },
]
const SYSTEM: SettingsEntry[] = [
  { id: 'integrations', labelKey: 'integrations.nav', icon: 'i-lucide-plug-zap', to: '/settings/system/integrations', capability: 'integrations.read' },
  { id: 'maintenance', labelKey: 'settings.maintenance.title', icon: 'i-lucide-calendar-clock', to: '/settings/system/maintenance', capability: 'settings.maintenance.manage' },
]
// The customer's subscription lives at /subscription (the approved SaaS commercial spec, 2026-10-02): the settings shell
// only lists it. /settings/billing stays absent: no billing placeholder under settings routes.
const BILLING: SettingsEntry[] = [
  { id: 'subscription', labelKey: 'settings.sections.billing.package', icon: 'i-lucide-credit-card', to: '/subscription', capability: 'subscription.read' },
  { id: 'subscription-change', labelKey: 'settings.sections.billing.change', icon: 'i-lucide-repeat', to: '/subscription/change', capability: 'subscription.manage' },
  { id: 'subscription-status', labelKey: 'settings.sections.billing.status', icon: 'i-lucide-activity', to: '/subscription/status', capability: 'subscription.read' },
  { id: 'subscription-branches', labelKey: 'settings.sections.billing.branches', icon: 'i-lucide-git-branch', to: '/subscription/branches', capability: 'subscription.read' },
  { id: 'subscription-invoices', labelKey: 'settings.sections.billing.invoices', icon: 'i-lucide-receipt', to: '/subscription/invoices', capability: 'billing.read' },
]

/** The five sections in their fixed order; the Apps entries come from the active manifests' `settings`. */
export function settingsSections(): SettingsSection[] {
  return [
    { id: 'company', labelKey: 'settings.sections.company.title', icon: 'i-lucide-building-2', within: '/settings/company', entries: COMPANY },
    { id: 'team', labelKey: 'settings.sections.team.title', icon: 'i-lucide-users', within: '/settings/team', entries: TEAM },
    { id: 'apps', labelKey: 'settings.sections.apps.title', icon: 'i-lucide-layout-grid', within: '/settings/apps', entries: activeManifests().flatMap(manifest => manifest.settings ?? []) },
    { id: 'system', labelKey: 'settings.sections.system.title', icon: 'i-lucide-shield-check', within: '/settings/system', entries: SYSTEM },
    { id: 'billing', labelKey: 'settings.sections.billing.title', icon: 'i-lucide-wallet', within: '/subscription', entries: BILLING },
  ]
}

/** The section a path belongs to, or null for the overview and for paths outside Settings. */
export function settingsSectionIdForPath(path: string): SettingsSectionId | null {
  const pathname = path.split(/[?#]/, 1)[0] ?? path
  return settingsSections().find(section => pathname === section.within || pathname.startsWith(`${section.within}/`))?.id ?? null
}

/** An entry whose page has sibling pages beneath it must match only itself, not its siblings. */
export function entryIsExact(entry: SettingsEntry, siblings: readonly SettingsEntry[]): boolean {
  return siblings.some(other => other.to.startsWith(`${entry.to}/`))
}
