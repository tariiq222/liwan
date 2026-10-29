import { canUse, featureForPath, hasFeature, pathIsWrite } from '../modules/registry'
import { activeManifests, manifestForPath, settingsPartForPath } from '../modules/manifests'
import { appSettingsPages, settingsPageForPath, settingsPages, type SettingsPage } from '../composables/nav/settingsSections'
import { normalizedPath } from './routePath'
import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'

/** Server capabilities gate navigation; resource authorization remains on the API. */
export type AccessIdentity = {
  role?: string
  capabilities?: readonly string[]
  modules?: readonly string[]
  entitlements?: Record<string, boolean | number | null>
  platform?: {
    readable_features: readonly string[]
    writable_features: readonly string[]
    state?: string
    read_only?: boolean
  }
} | null | undefined
/** Authenticated WebVue /api/v1/me identities carry a capabilities array. Portal/legacy role-only objects do not. */
export const INTERNAL_WEBVUE_ACCESS = 'webvue.internal'
/** UI predicate for the shared inbox; this is not a server capability grant. */
export const NOTIFICATION_ACCESS = 'webvue.notifications'
export function hasCapability(identity: AccessIdentity, capability: string): boolean {
  if (capability === INTERNAL_WEBVUE_ACCESS) return Array.isArray(identity?.capabilities)
  if (capability === NOTIFICATION_ACCESS) {
    return activeManifests().some(manifest => manifest.bell?.capabilities.some(key => identity?.capabilities?.includes(key)))
  }
  return identity?.capabilities?.includes(capability) ?? false
}

type Destination = readonly [path: string, capability: string]
const FOUNDATION_RETURN_TO = ['/', '/account', '/search', '/notifications', '/apps']
/** The destinations of a settings page's parts: a part with its own or full list page opens it, a card opens the page. */
function pageDestinations(pages: readonly SettingsPage[]): Destination[] {
  return pages.flatMap(page => page.parts.map((part): Destination => [part.to ?? part.within ?? page.to, part.capability]))
}
const settingsPage = (id: string) => settingsPages().filter(page => page.id === id)
/** Application landings in rail order, then team settings, then the landings that sort after settings, the applications' settings pages, then company and system settings. */
function destinations(): readonly Destination[] {
  const landing = activeManifests().flatMap(manifest => manifest.landing ?? [])
  const toDestination = (entry: { path: string; capability: string }): Destination => [entry.path, entry.capability]
  return [
    ...landing.filter(entry => !entry.late).map(toDestination),
    ...pageDestinations(settingsPage('team')),
    ...landing.filter(entry => entry.late).map(toDestination),
    ...pageDestinations(appSettingsPages()),
    ...pageDestinations(settingsPage('company')),
    ...pageDestinations(settingsPage('system')),
  ]
}
/** `feature` is an entry's explicit sub-feature (manifest `feature`), required on top of the capability's own gates. */
export function canReach(identity: AccessIdentity, capability: string, path?: string, feature?: string): boolean {
  if (capability === INTERNAL_WEBVUE_ACCESS && path === '/') return hasCapability(identity, capability)
  if (capability === NOTIFICATION_ACCESS) {
    return hasCapability(identity, capability) && canUse(identity, capability)
  }
  if (!hasCapability(identity, capability)) return false
  const write = path ? pathIsWrite(path) : false
  if (!canUse(identity, capability, write)) return false
  return hasFeature(identity, path ? featureForPath(path) : null, write) && hasFeature(identity, feature ?? null, write)
}
export function firstAllowedPath(identity: AccessIdentity): string {
  return destinations().find(([path, capability]) => canReach(identity, capability, path) && canReachPath(identity, path))?.[0] ?? '/account'
}
/**
 * Where an application's rail root sends an identity that cannot open the root itself: the first landing of that
 * application it can reach. Null for any other path, or when the application offers it nothing.
 */
export function appRootFallback(identity: AccessIdentity, path: string): string | null {
  const manifest = activeManifests().find(item => item.rail.some(entry => entry.to === path))
  if (!manifest || canReachPath(identity, path)) return null
  return (manifest.landing ?? []).find(entry => canReach(identity, entry.capability, entry.path) && canReachPath(identity, entry.path))?.path ?? null
}
export function postLoginPath(identity: AccessIdentity, next: unknown): string {
  const fallback = Array.isArray(identity?.capabilities) ? '/' : firstAllowedPath(identity)
  const target = safeReturnTo(next, fallback, [...destinations().map(([path]) => path), ...FOUNDATION_RETURN_TO, ...activeManifests().flatMap(manifest => manifest.returnToPaths ?? [])])
  const pathname = new URL(target, 'http://webvue.local').pathname
  return canReachPath(identity, pathname) ? target : fallback
}
/** The settings overview page; every other settings page lives beneath it, so it matches only itself. */
export const SETTINGS_OVERVIEW_PATH = '/settings'
export function isNavPathActive(path: string, target: string): boolean {
  if (target === SETTINGS_OVERVIEW_PATH) return path === target
  for (const manifest of activeManifests()) {
    const active = manifest.isNavActive?.(path, target)
    if (active !== undefined) return active
  }
  return path === target || path.startsWith(`${target}/`)
}
/** The rule of the manifest that claims `path` by prefix, or whose settings page contains it (a settings sub-page with a capability of its own). */
function ownedRouteRule(path: string) {
  return (manifestForPath(path) ?? settingsPartForPath(path)?.manifest)?.routeCapabilities?.find(rule => rule.pattern.test(path))
}
/** The explicit sub-feature of the manifest rule that owns `path`, if it declares one. */
export function requiredFeatureForPath(path: string): string | undefined {
  return ownedRouteRule(path)?.feature
}
export function requiredCapabilityForPath(path: string): string | null {
  const owned = ownedRouteRule(path)
  if (owned) return owned.capability
  const registered = settingsPartForPath(path)
  if (registered) return registered.part.capability
  if (path === '/') return INTERNAL_WEBVUE_ACCESS
  if (path === '/notifications') return NOTIFICATION_ACCESS
  if (path === '/settings/team/users/new') return 'access.users.grant'
  if (/^\/settings\/team\/users\/[^/]+\/(access|branches)$/.test(path)) return 'access.users.assign_roles'
  if (/^\/settings\/team\/roles\/(new|[^/]+\/edit)$/.test(path)) return 'access.roles.manage'
  return destinations().find(([target]) => isNavPathActive(path, target))?.[1] ?? null
}
/** The cards of a settings page when `path` is that page itself: it opens for anyone who may see one of them. */
function settingsCardsOpeningPage(path: string): string[] | null {
  const page = settingsPageForPath(path)
  if (!page || normalizedPath(path) !== page.to) return null
  const cards = page.parts.filter(part => part.to === undefined)
  return cards.length ? cards.map(({ capability }) => capability) : null
}
/**
 * Route-level gate. A path with a capability rule goes through `canReach`; a path an application
 * claims by prefix but no rule covers still needs that application's feature (never fail-open).
 */
export function canReachPath(identity: AccessIdentity, path: string): boolean {
  if (/^\/settings\/team\/(branches|users\/[^/]+\/branches)$/.test(normalizedPath(path)) && !hasCapability(identity, 'access.roles.read')) return false
  const rule = ownedRouteRule(path)
  if (rule?.anyCapabilities && !rule.anyCapabilities.some(key => hasCapability(identity, key))) return false
  if (rule?.requiredCapabilities && !rule.requiredCapabilities.every(key => canReach(identity, key))) return false
  const cards = settingsCardsOpeningPage(path)
  if (cards) return cards.some(capability => canReach(identity, capability, normalizedPath(path)))
  const capability = requiredCapabilityForPath(path)
  if (capability) return canReach(identity, capability, path, requiredFeatureForPath(path))
  const manifest = manifestForPath(path)
  return !manifest || hasFeature(identity, manifest.feature, pathIsWrite(path))
}
