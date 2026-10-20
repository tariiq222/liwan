// Relative imports: unit-tested directly under plain vitest.
import { activeManifests } from '../../modules/manifests'
import type { AppSettingsPage, AppSettingsPart } from '../../modules/types'

export type SettingsPartTarget = string | { path: string; hash: string }
/** A settings page: the foundation's own (company, team, system, billing) and one per application manifest. */
export interface SettingsPage extends AppSettingsPage {
  /** Path prefix that marks the page as open. */
  within: string
  /** Locale key of the heading over the page's link in the sidebar's first card (the applications' pages). */
  group?: string
}

const APPS_GROUP = 'settings.sections.apps.title'

const COMPANY: SettingsPage = {
  id: 'company', labelKey: 'settings.sections.company.title', icon: 'i-lucide-building-2', to: '/settings/company', within: '/settings/company',
  parts: [
    { id: 'profile', labelKey: 'settings.sections.company.profile', icon: 'i-lucide-building-2', capability: 'settings.company.read' },
    { id: 'address', labelKey: 'settings.sections.company.address', icon: 'i-lucide-map-pin', capability: 'settings.company.read' },
    { id: 'contact', labelKey: 'settings.sections.company.contact', icon: 'i-lucide-phone', capability: 'settings.company.read' },
    { id: 'branding', labelKey: 'settings.sections.company.branding', icon: 'i-lucide-palette', capability: 'settings.branding.manage' },
  ],
}
// The team's lists are preview cards; each full list is a page of its own that keeps its card lit.
const TEAM: SettingsPage = {
  id: 'team', labelKey: 'settings.sections.team.title', icon: 'i-lucide-users', to: '/settings/team', within: '/settings/team',
  parts: [
    { id: 'users', labelKey: 'nav.users', icon: 'i-lucide-user-cog', capability: 'access.users.read', within: '/settings/team/users' },
    { id: 'roles', labelKey: 'nav.roles', icon: 'i-lucide-shield-check', capability: 'access.roles.read', within: '/settings/team/roles' },
    { id: 'access-log', labelKey: 'nav.accessLog', icon: 'i-lucide-history', capability: 'access.audit.read', within: '/settings/team/access-log' },
  ],
}
const SYSTEM: SettingsPage = {
  id: 'system', labelKey: 'settings.sections.system.title', icon: 'i-lucide-shield-check', to: '/settings/system', within: '/settings/system',
  parts: [
    { id: 'integrations', labelKey: 'integrations.nav', icon: 'i-lucide-plug-zap', capability: 'integrations.read' },
    { id: 'maintenance', labelKey: 'settings.maintenance.title', icon: 'i-lucide-calendar-clock', capability: 'settings.maintenance.manage' },
  ],
}
// The customer's subscription lives at /subscription (the approved SaaS commercial spec, 2026-10-02): the settings shell
// only lists it, one page per part. /settings/billing stays absent: no billing placeholder under settings routes.
const BILLING: SettingsPage = {
  id: 'billing', labelKey: 'settings.sections.billing.title', icon: 'i-lucide-wallet', to: '/subscription', within: '/subscription',
  parts: [
    { id: 'subscription', labelKey: 'settings.sections.billing.package', icon: 'i-lucide-credit-card', capability: 'subscription.read', to: '/subscription' },
    { id: 'subscription-change', labelKey: 'settings.sections.billing.change', icon: 'i-lucide-repeat', capability: 'subscription.manage', to: '/subscription/change' },
    { id: 'subscription-status', labelKey: 'settings.sections.billing.status', icon: 'i-lucide-activity', capability: 'subscription.read', to: '/subscription/status' },
    { id: 'subscription-branches', labelKey: 'settings.sections.billing.branches', icon: 'i-lucide-git-branch', capability: 'subscription.read', to: '/subscription/branches' },
    { id: 'subscription-invoices', labelKey: 'settings.sections.billing.invoices', icon: 'i-lucide-receipt', capability: 'billing.read', to: '/subscription/invoices' },
  ],
}

/** The applications' settings pages, from the active manifests' `settings`, in manifest order. */
export function appSettingsPages(): SettingsPage[] {
  return activeManifests().flatMap(manifest => (manifest.settings ? [{ ...manifest.settings, within: manifest.settings.to, group: APPS_GROUP }] : []))
}

/** The settings pages in their fixed order: company, team, the applications, system, billing. */
export function settingsPages(): SettingsPage[] {
  return [COMPANY, TEAM, ...appSettingsPages(), SYSTEM, BILLING]
}

const pathnameOf = (path: string) => path.split(/[?#]/, 1)[0] ?? path

/** The page a path belongs to, or null for the overview and for paths outside Settings. */
export function settingsPageForPath(path: string): SettingsPage | null {
  const pathname = pathnameOf(path)
  return settingsPages().find(page => pathname === page.within || pathname.startsWith(`${page.within}/`)) ?? null
}

/** Where a part leads when it is not scrolled to: its own page, else the path with its id as the hash. */
export function settingsPartTarget(page: SettingsPage, part: AppSettingsPart): SettingsPartTarget {
  return part.to ?? { path: page.to, hash: `#${part.id}` }
}

/** The path a nav item (palette, search, shortcuts) opens for a part: its own or full page, else the page with the hash. */
export function settingsPartPath(page: SettingsPage, part: AppSettingsPart): string {
  return part.to ?? part.within ?? `${page.to}#${part.id}`
}

/** A part whose page has sibling pages beneath it must match only itself, not its siblings. */
export function partIsExact(part: AppSettingsPart, siblings: readonly AppSettingsPart[]): boolean {
  return part.to !== undefined && siblings.some(other => other.to?.startsWith(`${part.to}/`))
}
