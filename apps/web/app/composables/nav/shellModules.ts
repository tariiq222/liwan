import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { canReach, canReachPath, SETTINGS_OVERVIEW_PATH, type AccessIdentity } from '../../utils/accessPolicy'
import { hasFeature } from '../../modules/registry'
import { activeManifests } from '../../modules/manifests'
import { normalizedPath } from '../../utils/routePath'
import { LAUNCHER_MODULE_ID } from './activeRoute'
import { partIsExact, settingsPageForPath, settingsPartPath, settingsPartTarget, settingsPages, type SettingsPage } from './settingsSections'
import type { AppSettingsPart, AppSidebarMenu } from '../../modules/types'
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
export interface NavItem { to: string; labelKey: string; icon: AppIcon; shortcut: string; goKey?: string; group?: NavGroup; module?: ShellModule; capability: string; anyCapabilities?: string[]; feature?: string }

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

const homeItem: NavItem = { to: '/', labelKey: 'nav.home', icon: House, shortcut: 'h', goKey: 'h', module: 'home', capability: 'liwan.internal' }

/** The parts of every settings page as nav items (palette, search and rail visibility); registered parts carry no shortcut. */
function settingsNavItems(): NavItem[] {
  return settingsPages().flatMap(page => page.parts.map((part): NavItem => {
    const to = settingsPartPath(page, part)
    const keys = SETTINGS_KEYS[to]
    return {
      to: part.navTo ?? to,
      labelKey: part.labelKey, icon: part.icon, capability: part.capability,
      ...(part.anyCapabilities ? { anyCapabilities: part.anyCapabilities } : {}),
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
  return allNavItems().filter((item) => {
    if (item.capability === 'liwan.internal') return internalAccess(item)
    return navAllowed(identity, item.capability, item.to, item.feature)
      || (item.anyCapabilities ?? []).some(key => navAllowed(identity, key, item.to, item.feature))
  })
}

export interface ShellModuleDefinition {
  id: ShellModule
  labelKey: string
  shortLabelKey?: string
  icon: AppIcon
  to: string
  /** Position in the icon row of the free base-system applications; set on those only. */
  core?: number
}

/** The start page of an application (`/apps/<id>`); it is not a manifest module, so no navigation item or capability belongs to it. */
export const LAUNCHER_MODULE: ShellModuleDefinition = { id: LAUNCHER_MODULE_ID, labelKey: 'nav.apps', icon: 'i-lucide-layout-grid', to: '/' }

/** Every rail module: home, the applications by manifest `order`, then settings (the rail places each by `core`). */
export function shellModuleList(): ShellModuleDefinition[] {
  const applications = activeManifests().flatMap(manifest => manifest.rail).sort((a, b) => a.order - b.order)
  return [
    { id: 'home', labelKey: 'nav.home', icon: House, to: '/' },
    ...applications.map(({ id, labelKey, shortLabelKey, icon, to, core }) => ({ id, labelKey, shortLabelKey, icon, to, ...(core ? { core } : {}) })),
    // Settings is administration only: the account card is in the sidebar footer and the appearance button in the top bar.
    { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: SETTINGS_OVERVIEW_PATH },
  ]
}

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
/** The path the identity must reach for a part: its own page, or the page holding it when it is a card. */
const partNavPath = (page: SettingsPage, part: AppSettingsPart) => part.to ?? page.to

export function visibleSettingsPages(identity?: AccessIdentity): { page: SettingsPage; parts: AppSettingsPart[] }[] {
  return settingsPages()
    .map(page => ({ page, parts: page.parts.filter(part => identity === undefined || navAllowed(identity, part.capability, partNavPath(page, part)) || (part.anyCapabilities ?? []).some(key => navAllowed(identity, key, partNavPath(page, part)))) }))
    .filter(({ parts }) => parts.length > 0)
}

/**
 * The sub-list links of an open settings page under its own heading. A card scrolls to itself on its page, a part
 * with its own page opens it.
 */
function partLinks({ page, parts }: { page: SettingsPage; parts: AppSettingsPart[] }): ShellContextLink[] {
  return parts.map((part): ShellContextLink => ({
    id: part.id, labelKey: part.labelKey, icon: part.icon, to: settingsPartTarget(page, part), capability: part.capability,
    section: page.labelKey,
    ...(part.within ? { within: part.within } : {}), ...(partIsExact(part, parts) ? { exact: true } : {}),
  }))
}

/**
 * The capability that opens one visible part: its own, or the held `anyCapabilities` key that admitted a part serving
 * two rights (a channels list that also serves a templates-only manager). A page link must name a capability the
 * identity holds, or the sidebar drops the page it just admitted.
 */
function openingCapability(identity: AccessIdentity | undefined, page: SettingsPage, part: AppSettingsPart): string {
  const path = partNavPath(page, part)
  if (!identity || navAllowed(identity, part.capability, path)) return part.capability
  return (part.anyCapabilities ?? []).find(key => navAllowed(identity, key, path)) ?? part.capability
}

/**
 * The settings sidebar: the overview and one link per page on top, always (the applications' pages under their own
 * heading); below them the parts of the open page under its heading. Each page link opens the first part the identity
 * may use. A page with tabs lists only its parts that open a page of their own: the tab strip holds its cards.
 */
function settingsContextLinks(path: string | undefined, identity?: AccessIdentity): ShellContextLink[] {
  const visible = visibleSettingsPages(identity)
  if (!visible.length) return []
  const first = visible[0]!
  const top: ShellContextLink[] = [
    { id: 'settings-overview', labelKey: 'settings.sections.overview', icon: 'i-lucide-layout-dashboard', to: SETTINGS_OVERVIEW_PATH, capability: openingCapability(identity, first.page, first.parts[0]!), exact: true },
    ...visible.map(({ page, parts }): ShellContextLink => ({
      id: `settings-${page.id}`, labelKey: page.labelKey, icon: page.icon, to: parts[0]!.to ?? page.to,
      capability: openingCapability(identity, page, parts[0]!),
      within: page.within, ...(page.group ? { group: page.group } : {}),
    })),
  ]
  const open = path ? visible.find(({ page }) => page.id === settingsPageForPath(path)?.id) : undefined
  // A page with tabs shows its cards in the tab strip, so the sub-list keeps only the parts with a page of their own.
  const parts = !open ? [] : open.page.groups?.length ? partLinks({ page: open.page, parts: open.parts.filter(part => part.to) }) : partLinks(open)
  return [...top, ...parts]
}

function resolveContextLinks(module: ShellModule, path: string | undefined, identity?: AccessIdentity): ShellContextLink[] {
  const owner = activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module))
  if (owner) return owner.contextLinks?.(path) ?? []
  return module === 'settings' ? settingsContextLinks(path, identity) : []
}

/** The flat sidebar menu the application behind a rail module declares, or undefined for the generic context-link menu. */
export function sidebarMenuForModule(module: ShellModule): AppSidebarMenu | undefined {
  return activeManifests().find(manifest => manifest.rail.some(entry => entry.id === module))?.sidebar
}

/** A module's context links before capability filtering (the breadcrumb names the page the user is on). */
export function moduleContextLinks(module: ShellModule, path?: string): ShellContextLink[] {
  return resolveContextLinks(module, path)
}

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  return resolveContextLinks(module, path, identity).filter(link => navAllowed(identity, link.capability, typeof link.to === 'string' ? link.to : link.to.path, link.feature))
}
