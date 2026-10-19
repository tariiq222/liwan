import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { canReach, SETTINGS_OVERVIEW_PATH, type AccessIdentity } from '../../utils/accessPolicy'
import { hasFeature } from '../../modules/registry'
import { activeManifests } from '../../modules/manifests'
import { normalizedPath } from '../../utils/routePath'
import { settingsSections, settingsSectionIdForPath, entryIsExact, type SettingsEntry, type SettingsSection } from './settingsSections'
import { CUSTOMER_COMMERCIAL_CAPABILITIES, deriveCustomerCapabilities } from '../../utils/customerCapabilities'
import type { AppIcon } from '../../modules/types'

// UIcon resolves these names from the local Lucide Iconify collection. Keep
// the names in this shared model so every shell consumer renders the same icon
// without importing Vue component implementations into navigation data.
const Settings = 'i-lucide-settings'
const House = 'i-lucide-house'

/** Rail module id; applications declare theirs in their manifest, the foundation adds home and settings. */
export type NavGroup = string
export type ShellModule = string
export interface NavItem { to: string; labelKey: string; icon: AppIcon; shortcut: string; goKey?: string; group?: NavGroup; module?: ShellModule; capability: string }

/** Search-page and go-key shortcuts of the foundation settings pages, by path (unique with the applications' nav shortcuts). */
const SETTINGS_KEYS: Readonly<Record<string, { shortcut: string; goKey?: string }>> = {
  '/settings/company/branding': { shortcut: 'i' },
  '/settings/system/maintenance': { shortcut: 'u' },
  '/settings/system/integrations': { shortcut: 'w' },
  '/settings/team/users': { shortcut: '7', goKey: 'u' },
  '/settings/team/roles': { shortcut: '8', goKey: 'r' },
  '/settings/team/access-log': { shortcut: '9' },
  '/subscription': { shortcut: 'b' },
}

const homeItem: NavItem = { to: '/', labelKey: 'nav.home', icon: House, shortcut: 'h', goKey: 'h', module: 'home', capability: 'webvue.internal' }

/** The settings pages of every section as nav items (palette, search and rail visibility); registered pages carry no shortcut. */
function settingsNavItems(): NavItem[] {
  return settingsSections().flatMap(section => section.entries).map((entry): NavItem => {
    const keys = SETTINGS_KEYS[entry.to]
    return {
      to: entry.to, labelKey: entry.labelKey, icon: entry.icon, capability: entry.capability,
      shortcut: keys?.shortcut ?? '', ...(keys?.goKey ? { goKey: keys.goKey } : {}), group: 'settings', module: 'settings',
    }
  })
}
const FOUNDATION_MODULES: ReadonlySet<string> = new Set(['home', 'settings'])

/** Application items in manifest (rail) order, then the settings pages. */
export function allNavItems(): NavItem[] {
  const applications = activeManifests().flatMap(manifest => manifest.nav.map((item): NavItem => ({
    ...item,
    group: manifest.defaultRail ?? manifest.id,
    module: item.module ?? manifest.id,
  })))
  return [homeItem, ...applications, ...settingsNavItems()]
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
const COMMERCIAL_CAPABILITIES: readonly string[] = CUSTOMER_COMMERCIAL_CAPABILITIES

/** Whether the identity may see a nav or context target: the customer commercial capabilities are derived and flag-gated. */
function navAllowed(identity: AccessIdentity, capability: string, to?: string): boolean {
  return COMMERCIAL_CAPABILITIES.includes(capability)
    ? customerCommercialOn() && (deriveCustomerCapabilities(identity?.capabilities) as string[]).includes(capability)
    : canReach(identity, capability, to)
}
export function useNav(identity: AccessIdentity): NavItem[] {
  // Shared-inbox access has no capability key: an authenticated identity may use the application when its feature is open.
  // A rail module no manifest declares stays gated.
  const internalAccess = (item: NavItem) => {
    const feature = featureForRailModule(item.module)
    return Array.isArray(identity?.capabilities) && feature !== undefined && hasFeature(identity, feature)
  }
  return allNavItems().filter(item => (item.capability === 'webvue.internal' ? internalAccess(item) : navAllowed(identity, item.capability, item.to)))
}

export interface ShellModuleDefinition {
  id: ShellModule
  labelKey: string
  icon: AppIcon
  to: string
}

/** Rail order (user decision 2026-09-11): applications by manifest `order`, then the settings utility slot. */
export function shellModuleList(): ShellModuleDefinition[] {
  const applications = activeManifests().flatMap(manifest => manifest.rail).sort((a, b) => a.order - b.order)
  return [
    { id: 'home', labelKey: 'nav.home', icon: House, to: '/' },
    ...applications.map(({ id, labelKey, icon, to }) => ({ id, labelKey, icon, to })),
    // Settings is administration only: account and appearance live in the header.
    { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: SETTINGS_OVERVIEW_PATH },
  ]
}
/** The rail of the discovered manifests, for consumers that only look up a heading or icon. */
export const shellModules: ShellModuleDefinition[] = shellModuleList()

export function visibleShellModules(identity: AccessIdentity): ShellModuleDefinition[] {
  const nav = useNav(identity)
  return shellModuleList().flatMap(module => {
    const destinations = nav.filter(item => item.module === module.id)
    if (!destinations.length) return []
    // Settings opens its overview; the other modules open their rail target when visible, else their first page.
    return [{ ...module, to: module.id === 'settings' ? module.to : destinations.find(item => item.to === module.to)?.to ?? destinations[0]!.to }]
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
  /** Active only on exactly this path (the settings overview, a page with sibling pages beneath it). */
  exact?: boolean
  /** Path prefix that marks the link active, when it is not the link's own target (a settings section opens its first page). */
  within?: string
}

/** Hide the pinned create on the projects list/form and inside a project workspace. */
export function hidePinnedNewProject(path: string): boolean {
  const target = normalizedPath(path)
  return target === '/projects' || target === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(target)
}

/** The sections that have at least one page this identity may open (all of them without an identity: the breadcrumb). */
export function visibleSettingsSections(identity?: AccessIdentity): { section: SettingsSection; entries: SettingsEntry[] }[] {
  return settingsSections()
    .map(section => ({ section, entries: section.entries.filter(entry => identity === undefined || navAllowed(identity, entry.capability, entry.to)) }))
    .filter(({ entries }) => entries.length > 0)
}

/**
 * The settings sidebar: the overview and one link per section on top, always; below them the pages of the open
 * section under its heading. Each section link opens the first page the identity may use.
 */
function settingsContextLinks(path: string | undefined, identity?: AccessIdentity): ShellContextLink[] {
  const visible = visibleSettingsSections(identity)
  if (!visible.length) return []
  const top: ShellContextLink[] = [
    { id: 'settings-overview', labelKey: 'settings.sections.overview', icon: 'i-lucide-layout-dashboard', to: SETTINGS_OVERVIEW_PATH, capability: visible[0]!.entries[0]!.capability, exact: true },
    ...visible.map(({ section, entries }): ShellContextLink => ({
      id: `settings-${section.id}`, labelKey: section.labelKey, icon: section.icon, to: entries[0]!.to, capability: entries[0]!.capability, within: section.within,
    })),
  ]
  const open = path ? visible.find(({ section }) => section.id === settingsSectionIdForPath(path)) : undefined
  const pages = open?.entries.map((entry): ShellContextLink => ({
    id: entry.id, labelKey: entry.labelKey, icon: entry.icon, to: entry.to, capability: entry.capability,
    section: entry.group ?? open.section.labelKey, ...(entryIsExact(entry, open.entries) ? { exact: true } : {}),
  })) ?? []
  return [...top, ...pages]
}

function resolveContextLinks(module: ShellModule, path: string | undefined, identity?: AccessIdentity): ShellContextLink[] {
  const owner = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module))
  if (owner) return owner.contextLinks?.(path) ?? []
  return module === 'settings' ? settingsContextLinks(path, identity) : []
}

/** A module's context links before capability filtering (the breadcrumb names the page the user is on). */
export function moduleContextLinks(module: ShellModule, path?: string): ShellContextLink[] {
  return resolveContextLinks(module, path)
}

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  return resolveContextLinks(module, path, identity).filter(link => navAllowed(identity, link.capability, typeof link.to === 'string' ? link.to : undefined))
}
