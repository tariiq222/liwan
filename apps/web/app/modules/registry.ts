const INTERNAL_NASQ_ACCESS = 'nasq.internal'
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

export const MODULE_FEATURES: Record<'home' | 'projects' | 'meetings' | 'chat' | 'hr' | 'settings' | 'vendor' | 'management', KnownFeatureKey | null> = {
  home: 'pmo.enabled',
  projects: 'pmo.enabled',
  meetings: 'meetings.enabled',
  chat: 'chat.enabled',
  hr: 'hr.enabled',
  settings: null,
  vendor: null,
  management: null,
}

/**
 * A capability's application feature is `<first segment>.enabled` (pmo, meetings, hr and any
 * newer application). Exceptions keep today's gates: chat's capability is `nasq.internal`,
 * and the foundation (`access`, `settings`, `nasq`), the vendor console and the customer
 * subscription prefixes belong to no application feature.
 */
const CAPABILITY_FEATURES: ReadonlyMap<string, FeatureKey> = new Map([[INTERNAL_NASQ_ACCESS, 'chat.enabled']])
// Any unknown dotted prefix is gated by `<prefix>.enabled`, so a new foundation-like prefix must be added here.
const FEATURELESS_PREFIXES: ReadonlySet<string> = new Set(['access', 'settings', 'nasq', 'vendor', 'subscription', 'billing', 'branches'])
/** A capability is a write unless its action (last segment) is `read`; `nasq.internal` only opens chat for reading. */
const READ_CAPABILITIES: ReadonlySet<string> = new Set([INTERNAL_NASQ_ACCESS])

export function featureGateActive(identity: TenantIdentity): boolean {
  return Boolean(identity && (identity.modules || identity.entitlements || identity.platform))
}

export function featureForCapability(capability: string): FeatureKey | null {
  const explicit = CAPABILITY_FEATURES.get(capability)
  if (explicit) return explicit
  const dot = capability.indexOf('.')
  if (dot < 1) return null
  const prefix = capability.slice(0, dot)
  return FEATURELESS_PREFIXES.has(prefix) ? null : `${prefix}.enabled`
}

export function isWriteCapability(capability: string): boolean {
  if (READ_CAPABILITIES.has(capability)) return false
  return capability.slice(capability.lastIndexOf('.') + 1) !== 'read'
}

export function featureForPath(path: string): FeatureKey | null {
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat.enabled'
  if (path === '/hr' || path.startsWith('/hr/')) return 'hr.enabled'
  if (path === '/meetings' || path.startsWith('/meetings/')) return 'meetings.enabled'
  if (
    path.startsWith('/projects')
    || path.startsWith('/tasks')
    || path.startsWith('/project-templates')
    || path.startsWith('/reports')
    || path === '/archived-tasks'
  ) return 'pmo.enabled'
  return null
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
    return hasFeature(identity, 'pmo.enabled') || hasFeature(identity, 'meetings.enabled')
  }
  return hasFeature(identity, featureForCapability(capability), write || isWriteCapability(capability))
}
