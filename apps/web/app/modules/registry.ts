import { activeManifests, appManifests, manifestForPath } from './manifests'

const NOTIFICATION_ACCESS = 'webvue.notifications'

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

/** Rail module id to its application feature, from the manifests; foundation modules carry no feature. */
export const MODULE_FEATURES: Record<string, string | null | undefined> = {
  ...Object.fromEntries(appManifests.flatMap(manifest => manifest.rail.map(entry => [entry.id, manifest.feature]))),
  home: null,
  settings: null,
}

/**
 * A capability's application feature is `<first segment>.enabled` (pmo, meetings, hr and any
 * newer application). An application manifest lists its exceptions in `capabilityAliases`
 * (chat's capability is `webvue.internal`); the foundation (`access`, `settings`, `webvue`) and the
 * customer subscription prefixes belong to no application feature.
 */
function aliasedFeature(capability: string): string | undefined {
  for (const manifest of activeManifests()) {
    const feature = manifest.capabilityAliases?.[capability]
    if (feature) return feature
  }
  return undefined
}
// Any unknown dotted prefix is gated by `<prefix>.enabled`, so a new foundation-like prefix must be added here.
const FEATURELESS_PREFIXES: ReadonlySet<string> = new Set(['access', 'settings', 'webvue', 'subscription', 'billing', 'branches'])

export function featureGateActive(identity: TenantIdentity): boolean {
  return Boolean(identity && (identity.modules || identity.entitlements || identity.platform))
}

export function featureForCapability(capability: string): string | null {
  const explicit = aliasedFeature(capability)
  if (explicit) return explicit
  const dot = capability.indexOf('.')
  if (dot < 1) return null
  const prefix = capability.slice(0, dot)
  return FEATURELESS_PREFIXES.has(prefix) ? null : `${prefix}.enabled`
}

export function isWriteCapability(capability: string): boolean {
  // An aliased capability (chat's `webvue.internal`) only opens its application for reading.
  if (aliasedFeature(capability)) return false
  return capability.slice(capability.lastIndexOf('.') + 1) !== 'read'
}

export function featureForPath(path: string): string | null {
  return manifestForPath(path)?.feature ?? null
}

/**
 * The `subFeatures` prefixes of the active manifests, merged: a capability prefix such as
 * `hr.recruitment.` to the area feature key it needs. Applications without areas declare
 * none, so the map stays empty for them.
 */
export function declaredSubFeatures(): Record<string, string> {
  const declared: Record<string, string> = {}
  for (const manifest of activeManifests()) {
    Object.assign(declared, manifest.subFeatures ?? {})
  }
  return declared
}

/**
 * The sub-feature a capability requires, or null when no declared prefix matches it. The
 * longest matching prefix wins, so a narrower area beats a broader one.
 */
export function subFeatureForCapability(
  capability: string,
  subFeatures: Record<string, string> = declaredSubFeatures(),
): string | null {
  let matched: string | null = null
  for (const prefix of Object.keys(subFeatures)) {
    if (!capability.startsWith(prefix)) continue
    if (matched === null || prefix.length > matched.length) matched = prefix
  }
  return matched === null ? null : subFeatures[matched] ?? null
}

export function pathIsWrite(path: string): boolean {
  return /\/(new|edit|access)(?:\/|$)/.test(path)
}

export function hasFeature(identity: TenantIdentity, key: string | null, write = false): boolean {
  if (!key) return true
  if (!featureGateActive(identity)) return true
  const platform = identity?.platform
  if (platform) {
    const list = write ? platform.writable_features : platform.readable_features
    return list.includes(key)
  }
  return identity?.entitlements?.[key] === true
}

/**
 * The gate of one capability at one level: the application feature, and the matched area
 * sub-feature when the capability declares one — both at the same read/write level, so a
 * read-only tenant keeps reads open and closes writes of both keys.
 */
export function capabilityAllowed(
  identity: TenantIdentity,
  capability: string,
  write: boolean,
  subFeatures: Record<string, string> = declaredSubFeatures(),
): boolean {
  return hasFeature(identity, featureForCapability(capability), write)
    && hasFeature(identity, subFeatureForCapability(capability, subFeatures), write)
}

export function canUse(identity: TenantIdentity, capability: string, write = false): boolean {
  if (capability === NOTIFICATION_ACCESS) {
    return activeManifests().some(manifest => manifest.bell && hasFeature(identity, manifest.feature))
  }
  return capabilityAllowed(identity, capability, write || isWriteCapability(capability))
}
