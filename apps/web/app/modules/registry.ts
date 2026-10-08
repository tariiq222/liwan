import { activeManifests, appManifests, manifestForPath } from './manifests'

const NOTIFICATION_ACCESS = 'nasq.notifications'

export type TenantIdentity = {
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

/** Today's application features; a newer application's `<app>.enabled` is any other string. */
export const KNOWN_FEATURE_KEYS = ['pmo.enabled', 'meetings.enabled', 'hr.enabled', 'chat.enabled'] as const
export type KnownFeatureKey = typeof KNOWN_FEATURE_KEYS[number]
export type FeatureKey = KnownFeatureKey | (string & {})

/** Rail module id to its application feature, from the manifests; foundation modules carry no feature. */
export const MODULE_FEATURES = {
  ...Object.fromEntries(appManifests.flatMap(manifest => manifest.rail.map(entry => [entry.id, manifest.feature]))),
  settings: null,
  vendor: null,
  management: null,
} as Record<'home' | 'projects' | 'meetings' | 'chat' | 'hr' | 'settings' | 'vendor' | 'management', FeatureKey | null>
  & Record<string, FeatureKey | null | undefined>

/**
 * A capability's application feature is `<first segment>.enabled` (pmo, meetings, hr and any
 * newer application). An application manifest lists its exceptions in `capabilityAliases`
 * (chat's capability is `nasq.internal`); the foundation (`access`, `settings`, `nasq`), the
 * vendor console and the customer subscription prefixes belong to no application feature.
 */
function aliasedFeature(capability: string): string | undefined {
  for (const manifest of activeManifests()) {
    const feature = manifest.capabilityAliases?.[capability]
    if (feature) return feature
  }
  return undefined
}
// Any unknown dotted prefix is gated by `<prefix>.enabled`, so a new foundation-like prefix must be added here.
const FEATURELESS_PREFIXES: ReadonlySet<string> = new Set(['access', 'settings', 'nasq', 'vendor', 'subscription', 'billing', 'branches'])

export function featureGateActive(identity: TenantIdentity): boolean {
  return Boolean(identity && (identity.modules || identity.entitlements || identity.platform))
}

export function featureForCapability(capability: string): FeatureKey | null {
  const explicit = aliasedFeature(capability)
  if (explicit) return explicit
  const dot = capability.indexOf('.')
  if (dot < 1) return null
  const prefix = capability.slice(0, dot)
  return FEATURELESS_PREFIXES.has(prefix) ? null : `${prefix}.enabled`
}

export function isWriteCapability(capability: string): boolean {
  // An aliased capability (chat's `nasq.internal`) only opens its application for reading.
  if (aliasedFeature(capability)) return false
  return capability.slice(capability.lastIndexOf('.') + 1) !== 'read'
}

export function featureForPath(path: string): FeatureKey | null {
  return manifestForPath(path)?.feature ?? null
}

export function pathIsWrite(path: string): boolean {
  return /\/(new|edit|access)(?:\/|$)/.test(path)
}

export function hasFeature(identity: TenantIdentity, key: FeatureKey | null, write = false): boolean {
  if (!key) return true
  if (!featureGateActive(identity)) return true
  const platform = identity?.platform
  if (platform) {
    const list = write ? platform.writable_features : platform.readable_features
    return list.includes(key)
  }
  return identity?.entitlements?.[key] === true
}

export function canUse(identity: TenantIdentity, capability: string, write = false): boolean {
  if (capability === NOTIFICATION_ACCESS) {
    return activeManifests().some(manifest => manifest.bell && hasFeature(identity, manifest.feature))
  }
  return hasFeature(identity, featureForCapability(capability), write || isWriteCapability(capability))
}
