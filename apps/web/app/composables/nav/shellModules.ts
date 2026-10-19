import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { canReach, type AccessIdentity } from '../../utils/accessPolicy'
import { hasFeature } from '../../modules/registry'
import { activeManifests } from '../../modules/manifests'
import { normalizedPath } from '../../utils/routePath'
import { deriveCustomerCapabilities } from '../../utils/customerCapabilities'
import type { AppIcon } from '../../modules/types'
import type { AccentName } from '@webvue/ui/app/types/shell'

// UIcon resolves these names from the local Lucide Iconify collection. Keep
// the names in this shared model so every shell consumer renders the same icon
// without importing Vue component implementations into navigation data.
const Settings = 'i-lucide-settings'
const ShieldCheck = 'i-lucide-shield-check'
const UserCog = 'i-lucide-user-cog'
const History = 'i-lucide-history'
const Palette = 'i-lucide-palette'
const House = 'i-lucide-house'

/** Rail module id; applications declare theirs in their manifest, the foundation adds home and settings. */
export type NavGroup = string
export type ShellModule = string
export interface NavItem { to: string; labelKey: string; icon: AppIcon; shortcut: string; goKey?: string; group?: NavGroup; module?: ShellModule; capability: string }

/** Nav items of the foundation (home, settings, subscription); applications declare theirs in their manifest. */
const foundationItems: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: House, shortcut: 'h', goKey: 'h', module: 'home', capability: 'webvue.internal' },
  { to: '/settings/maintenance', labelKey: 'settings.maintenance.title', icon: 'i-lucide-calendar-clock', shortcut: 'u', group: 'settings', module: 'settings', capability: 'settings.maintenance.manage' },
  { to: '/settings/branding', labelKey: 'settings.branding.title', icon: Palette, shortcut: 'i', group: 'settings', module: 'settings', capability: 'settings.branding.manage' },
  { to: '/settings/integrations', labelKey: 'integrations.nav', icon: 'i-lucide-plug-zap', shortcut: 'w', group: 'settings', module: 'settings', capability: 'integrations.read' },
  { to: '/settings/users', labelKey: 'nav.users', icon: UserCog, shortcut: '7', goKey: 'u', group: 'settings', module: 'settings', capability: 'access.users.read' },
  { to: '/settings/roles', labelKey: 'nav.roles', icon: ShieldCheck, shortcut: '8', goKey: 'r', group: 'settings', module: 'settings', capability: 'access.roles.read' },
  { to: '/settings/access-log', labelKey: 'nav.accessLog', icon: History, shortcut: '9', group: 'settings', module: 'settings', capability: 'access.audit.read' },
  // The approved SaaS commercial spec (2026-10-02) puts the customer's subscription inside the workspace as /subscription,
  // gated by the customer capability subscription.read (derived from WebVue settings capabilities, see utils/customerCapabilities.ts)
  // and the customerCommercialEnabled runtime flag. /settings/billing stays absent: no billing placeholder under settings routes.
  { to: '/subscription', labelKey: 'subscription.nav', icon: 'i-lucide-credit-card', shortcut: 'b', group: 'settings', module: 'settings', capability: 'subscription.read' },
]
const FOUNDATION_MODULES: ReadonlySet<string> = new Set(['home', 'settings'])

/** Application items in manifest (rail) order, then the foundation items. */
export function allNavItems(): NavItem[] {
  const applications = activeManifests().flatMap(manifest => manifest.nav.map((item): NavItem => ({
    ...item,
    group: manifest.defaultRail ?? manifest.id,
    module: item.module ?? manifest.id,
  })))
  return [foundationItems[0]!, ...applications, ...foundationItems.slice(1)]
}

/**
 * The application feature behind a rail module: null for foundation modules, undefined for a module
 * no manifest declares (callers treat that as gated, never as open).
 */
export function featureForRailModule(id: string | undefined): string | null | undefined {
  if (!id) return undefined
  if (FOUNDATION_MODULES.has(id)) return null
  return activeManifests().find(manifest => manifest.rail.some(entry => entry.id === id))?.feature
}
/** Runtime flag for the customer commercial BFF; false in tests/non_saas unless the runtime config enables it. */
function customerCommercialOn(): boolean {
  try {
    const flag = typeof useRuntimeConfig === 'function' ? (useRuntimeConfig() as { public?: { customerCommercialEnabled?: unknown } }).public?.customerCommercialEnabled : false
    return flag === true || flag === 'true'
  } catch { return false }
}
export function useNav(identity: AccessIdentity): NavItem[] {
  // Shared-inbox access has no capability key: an authenticated identity may use the application when its feature is open.
  // A rail module no manifest declares stays gated.
  const internalAccess = (item: NavItem) => {
    const feature = featureForRailModule(item.module)
    return Array.isArray(identity?.capabilities) && feature !== undefined && hasFeature(identity, feature)
  }
  return allNavItems().filter(item => (
    item.capability === 'webvue.internal'
      ? internalAccess(item)
      : item.capability.startsWith('subscription.')
        ? customerCommercialOn() && (deriveCustomerCapabilities(identity?.capabilities) as string[]).includes(item.capability)
        : canReach(identity, item.capability, item.to)
  ))
}

export interface ShellModuleDefinition {
  id: ShellModule
  labelKey: string
  icon: AppIcon
  to: string
  accent: AccentName
}

/** Rail order (user decision 2026-09-11): applications by manifest `order`, then the settings utility slot. */
export function shellModuleList(): ShellModuleDefinition[] {
  const applications = activeManifests().flatMap(manifest => manifest.rail).sort((a, b) => a.order - b.order)
  return [
    { id: 'home', labelKey: 'nav.home', icon: House, to: '/', accent: 'slate' },
    ...applications.map(({ id, labelKey, icon, to, accent }) => ({ id, labelKey, icon, to, accent: accent ?? 'slate' })),
    // Settings is administration only: account and appearance live in the header.
    { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: '/settings/users', accent: 'slate' },
  ]
}
/** The rail of the discovered manifests, for consumers that only look up a heading or icon. */
export const shellModules: ShellModuleDefinition[] = shellModuleList()

export function visibleShellModules(identity: AccessIdentity): ShellModuleDefinition[] {
  const nav = useNav(identity)
  return shellModuleList().flatMap(module => {
    const destinations = nav.filter(item => item.module === module.id)
    if (!destinations.length) return []
    return [{ ...module, to: destinations.find(item => item.to === module.to)?.to ?? destinations[0]!.to }]
  })
}

export interface ShellContextLink {
  id: string
  labelKey: string
  icon: AppIcon
  to: RouteLocationRaw
  capability: string
  active?: boolean
  pinned?: boolean
  section?: string
}

/** Hide the pinned create on the projects list/form and inside a project workspace. */
export function hidePinnedNewProject(path: string): boolean {
  const target = normalizedPath(path)
  return target === '/projects' || target === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(target)
}

const foundationContextLinks: Record<string, ShellContextLink[]> = {
  settings: [
    { id: 'users', labelKey: 'nav.users', icon: UserCog, to: '/settings/users', capability: 'access.users.read' },
    { id: 'roles', labelKey: 'nav.roles', icon: ShieldCheck, to: '/settings/roles', capability: 'access.roles.read' },
    { id: 'access-log', labelKey: 'nav.accessLog', icon: History, to: '/settings/access-log', capability: 'access.audit.read' },
    { id: 'maintenance', labelKey: 'settings.maintenance.title', icon: 'i-lucide-calendar-clock', to: '/settings/maintenance', capability: 'settings.maintenance.manage' },
    { id: 'branding', labelKey: 'settings.branding.title', icon: Palette, to: '/settings/branding', capability: 'settings.branding.manage' },
    { id: 'integrations', labelKey: 'integrations.nav', icon: 'i-lucide-plug-zap', to: '/settings/integrations', capability: 'integrations.read' },
  ],
}

/** A module's context links before capability filtering (the breadcrumb names the page the user is on). */
export function moduleContextLinks(module: ShellModule, path?: string): ShellContextLink[] {
  const owner = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module))
  return owner ? owner.contextLinks?.(path) ?? [] : foundationContextLinks[module] ?? []
}

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  return moduleContextLinks(module, path).filter(link => canReach(identity, link.capability, typeof link.to === 'string' ? link.to : undefined))
}
