import { canUse, featureForPath, hasFeature, pathIsWrite } from '../modules/registry'
import { activeManifests, manifestForPath } from '../modules/manifests'
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
// Foundation destinations stay here; applications add theirs through `landing`.
const FOUNDATION_SETTINGS: readonly Destination[] = [
  ['/settings/users', 'access.users.read'], ['/settings/roles', 'access.roles.read'], ['/settings/access-log', 'access.audit.read'],
]
const FOUNDATION_LAST: readonly Destination[] = [['/settings/branding', 'settings.branding.manage']]
const FOUNDATION_RETURN_TO = ['/', '/account', '/search', '/notifications']
/** Application landings in rail order, then settings, then the landings that sort after settings, then branding. */
function destinations(): readonly Destination[] {
  const landing = activeManifests().flatMap(manifest => manifest.landing ?? [])
  const toDestination = (entry: { path: string; capability: string }): Destination => [entry.path, entry.capability]
  return [
    ...landing.filter(entry => !entry.late).map(toDestination),
    ...FOUNDATION_SETTINGS,
    ...landing.filter(entry => entry.late).map(toDestination),
    ...FOUNDATION_LAST,
  ]
}
export function canReach(identity: AccessIdentity, capability: string, path?: string): boolean {
  if (capability === INTERNAL_WEBVUE_ACCESS && path === '/') return hasCapability(identity, capability)
  if (capability === NOTIFICATION_ACCESS) {
    return hasCapability(identity, capability) && canUse(identity, capability)
  }
  if (!hasCapability(identity, capability)) return false
  const write = path ? pathIsWrite(path) : false
  if (!canUse(identity, capability, write)) return false
  const feature = path ? featureForPath(path) : null
  return hasFeature(identity, feature, write)
}
export function firstAllowedPath(identity: AccessIdentity): string {
  return destinations().find(([path, capability]) => canReach(identity, capability, path))?.[0] ?? '/account'
}
export function postLoginPath(identity: AccessIdentity, next: unknown): string {
  const fallback = Array.isArray(identity?.capabilities) ? '/' : firstAllowedPath(identity)
  const target = safeReturnTo(next, fallback, [...destinations().map(([path]) => path), ...FOUNDATION_RETURN_TO, ...activeManifests().flatMap(manifest => manifest.returnToPaths ?? [])])
  const pathname = new URL(target, 'http://webvue.local').pathname
  const capability = requiredCapabilityForPath(pathname)
  return capability && !canReach(identity, capability, pathname) ? fallback : target
}
export function isNavPathActive(path: string, target: string): boolean {
  for (const manifest of activeManifests()) {
    const active = manifest.isNavActive?.(path, target)
    if (active !== undefined) return active
  }
  return path === target || path.startsWith(`${target}/`)
}
export function isProjectSettingsPath(path: string): boolean {
  return path === '/projects/settings' || path.startsWith('/projects/settings/')
}
export function requiredCapabilityForPath(path: string): string | null {
  const owned = manifestForPath(path)?.routeCapabilities?.find(rule => rule.pattern.test(path))
  if (owned) return owned.capability
  if (path === '/') return INTERNAL_WEBVUE_ACCESS
  if (path === '/notifications') return NOTIFICATION_ACCESS
  if (path === '/settings/users/new') return 'access.users.grant'
  if (/^\/settings\/users\/[^/]+\/access$/.test(path)) return 'access.users.assign_roles'
  if (/^\/settings\/roles\/(new|[^/]+\/edit)$/.test(path)) return 'access.roles.manage'
  return destinations().find(([target]) => isNavPathActive(path, target))?.[1] ?? null
}
/**
 * Route-level gate. A path with a capability rule goes through `canReach`; a path an application
 * claims by prefix but no rule covers still needs that application's feature (never fail-open).
 */
export function canReachPath(identity: AccessIdentity, path: string): boolean {
  const capability = requiredCapabilityForPath(path)
  if (capability) return canReach(identity, capability, path)
  const manifest = manifestForPath(path)
  return !manifest || hasFeature(identity, manifest.feature, pathIsWrite(path))
}
