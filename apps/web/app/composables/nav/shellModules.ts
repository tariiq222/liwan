import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { canReach, canReachPath, SETTINGS_OVERVIEW_PATH, type AccessIdentity } from '../../utils/accessPolicy'
import { hasFeature } from '../../modules/registry'
import { activeManifests } from '../../modules/manifests'
import { normalizedPath } from '../../utils/routePath'
import { LAUNCHER_MODULE_ID } from './activeRoute'
import { partIsExact, settingsPageForPath, settingsPartPath, settingsPartTarget, settingsPages, type SettingsPage } from './settingsSections'
import type { AppSettingsPart } from '../../modules/types'
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
export interface NavItem { to: string; labelKey: string; icon: AppIcon; shortcut: string; goKey?: string; group?: NavGroup; module?: ShellModule; capability: string; feature?: string }

/** Search-page and go-key shortcuts of the foundation settings pages, by path (unique with the applications' nav shortcuts). */
const SETTINGS_KEYS: Readonly<Record<string, { shortcut: string; goKey?: string }>> = {
  '/settings/company#branding': { shortcut: 'i' },
  '/settings/system#maintenance': { shortcut: 'u' },
  '/settings/system#integrations': { shortcut: 'w' },
  '/settings/team/users': { shortcut: '7', goKey: 'u' },
  '/settings/team/roles': { shortcut: '8', goKey: 'r' },
  '/settings/team/access-log': { shortcut: '9' },
  '/subscription': { shortcut: 'b' },
}

const homeItem: NavItem = { to: '/', labelKey: 'nav.home', icon: House, shortcut: 'h', goKey: 'h', module: 'home', capability: 'webvue.internal' }

/** The parts of every settings page as nav items (palette, search and rail visibility); registered parts carry no shortcut. */
function settingsNavItems(): NavItem[] {
  return settingsPages().flatMap(page => page.parts.map((part): NavItem => {
    const to = settingsPartPath(page, part)
    const keys = SETTINGS_KEYS[to]
    return {
      to, labelKey: part.labelKey, icon: part.icon, capability: part.capability,
      shortcut: keys?.shortcut ?? '', ...(keys?.goKey ? { goKey: keys.goKey } : {}), group: 'settings', module: 'settings',
    }
  }))
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
function navAllowed(identity: AccessIdentity, capability: string, to?: string, feature?: string): boolean {
  return COMMERCIAL_CAPABILITIES.includes(capability)
    ? customerCommercialOn() && (deriveCustomerCapabilities(identity?.capabilities) as string[]).includes(capability)
    : canReach(identity, capability, to, feature) && (!to || canReachPath(identity, to.split(/[?#]/, 1)[0]!))
}
export function useNav(identity: AccessIdentity): NavItem[] {
  // Shared-inbox access has no capability key: an authenticated identity may use the application when its feature is open.
  // A rail module no manifest declares stays gated.
  const internalAccess = (item: NavItem) => {
    const feature = featureForRailModule(item.module)
    return Array.isArray(identity?.capabilities) && feature !== undefined && hasFeature(identity, feature)
  }
  return allNavItems().filter(item => (item.capability === 'webvue.internal' ? internalAccess(item) : navAllowed(identity, item.capability, item.to, item.feature)))
}

export interface ShellModuleDefinition {
  id: ShellModule
  labelKey: string
  shortLabelKey?: string
  icon: AppIcon
  to: string
  /** Placed in the rail's bottom utility slot above settings. */
  utility?: boolean
}

/** The launcher page; it is not a manifest module, so no navigation item or capability belongs to it. */
export const LAUNCHER_MODULE: ShellModuleDefinition = { id: LAUNCHER_MODULE_ID, labelKey: 'nav.apps', icon: 'i-lucide-layout-grid', to: '/apps' }

/** The label key naming the open area in the drawer and sidebar heading: its module, «التطبيقات» on the launcher, else the product name. */
export function areaLabelKey(definition: Pick<ShellModuleDefinition, 'labelKey'> | null | undefined, activeModule: ShellModule | null): string {
  if (definition) return definition.labelKey
  return activeModule === LAUNCHER_MODULE_ID ? LAUNCHER_MODULE.labelKey : 'app.productName'
}

/** Rail order (user decision 2026-09-11): applications by manifest `order`, then the settings utility slot. */
export function shellModuleList(): ShellModuleDefinition[] {
  const applications = activeManifests().flatMap(manifest => manifest.rail).sort((a, b) => a.order - b.order)
  return [
    { id: 'home', labelKey: 'nav.home', icon: House, to: '/' },
    ...applications.map(({ id, labelKey, shortLabelKey, icon, to, utility }) => ({ id, labelKey, shortLabelKey, icon, to, ...(utility ? { utility } : {}) })),
    // Settings is administration only: account and appearance live in the header.
    { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: SETTINGS_OVERVIEW_PATH, utility: true },
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
  feature?: string
  active?: boolean
  pinned?: boolean
  section?: string
  /** Locale key of a heading inside the first card over this link and the consecutive ones with the same key. */
  group?: string
  /** Active only on exactly this path (the settings overview, a page with sibling pages beneath it). */
  exact?: boolean
  /** Path prefix that marks the link active, when it is not the link's own target (a settings page opens its first card). */
  within?: string
}

/** Hide the pinned create on the projects list/form and inside a project workspace. */
export function hidePinnedNewProject(path: string): boolean {
  const target = normalizedPath(path)
  return target === '/projects' || target === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(target)
}

/** The settings pages with at least one part this identity may open (all of them without an identity: the breadcrumb). */
export function visibleSettingsPages(identity?: AccessIdentity): { page: SettingsPage; parts: AppSettingsPart[] }[] {
  return settingsPages()
    .map(page => ({ page, parts: page.parts.filter(part => identity === undefined || navAllowed(identity, part.capability, settingsPartPath(page, part)) || (part.anyCapabilities ?? []).some(key => navAllowed(identity, key, settingsPartPath(page, part)))) }))
    .filter(({ parts }) => parts.length > 0)
}

/**
 * The settings sidebar: the overview and one link per page on top, always (the applications' pages under their own
 * heading); below them the parts of the open page under its heading. A card scrolls to itself on its page, a part with
 * its own page opens it. Each page link opens the first part the identity may use.
 */
function settingsContextLinks(path: string | undefined, identity?: AccessIdentity): ShellContextLink[] {
  const visible = visibleSettingsPages(identity)
  if (!visible.length) return []
  const top: ShellContextLink[] = [
    { id: 'settings-overview', labelKey: 'settings.sections.overview', icon: 'i-lucide-layout-dashboard', to: SETTINGS_OVERVIEW_PATH, capability: visible[0]!.parts[0]!.capability, exact: true },
    ...visible.map(({ page, parts }): ShellContextLink => ({
      id: `settings-${page.id}`, labelKey: page.labelKey, icon: page.icon, to: parts[0]!.to ?? page.to, capability: parts[0]!.capability,
      within: page.within, ...(page.group ? { group: page.group } : {}),
    })),
  ]
  const open = path ? visible.find(({ page }) => page.id === settingsPageForPath(path)?.id) : undefined
  const parts = open?.parts.map((part): ShellContextLink => ({
    id: part.id, labelKey: part.labelKey, icon: part.icon, to: settingsPartTarget(open.page, part), capability: part.capability,
    section: open.page.labelKey,
    ...(part.within ? { within: part.within } : {}), ...(partIsExact(part, open.parts) ? { exact: true } : {}),
  })) ?? []
  return [...top, ...parts]
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
  return resolveContextLinks(module, path, identity).filter(link => navAllowed(identity, link.capability, typeof link.to === 'string' ? link.to : link.to.path, link.feature))
}
