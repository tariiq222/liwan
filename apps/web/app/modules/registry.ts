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

export type FeatureKey = 'pmo.enabled' | 'meetings.enabled' | 'hr.enabled' | 'chat.enabled'

export const MODULE_FEATURES: Record<'home' | 'projects' | 'meetings' | 'chat' | 'hr' | 'settings' | 'vendor', FeatureKey | null> = {
  home: 'pmo.enabled',
  projects: 'pmo.enabled',
  meetings: 'meetings.enabled',
  chat: 'chat.enabled',
  hr: 'hr.enabled',
  settings: null,
  vendor: null,
}

const WRITE_CAPABILITIES = new Set([
  'pmo.projects.create', 'pmo.projects.manage', 'pmo.settings.manage',
  'pmo.tasks.create', 'pmo.tasks.write', 'pmo.tasks.approve',
  'meetings.create',
  'hr.employees.manage', 'hr.employees.archive', 'hr.departments.manage', 'hr.documents.manage',
  'access.users.grant', 'access.users.assign_roles', 'access.users.disable', 'access.users.reset_password',
  'access.roles.manage', 'settings.branding.manage',
])

export function featureGateActive(identity: TenantIdentity): boolean {
  return Boolean(identity && (identity.modules || identity.entitlements || identity.platform))
}

export function featureForCapability(capability: string): FeatureKey | null {
  if (capability.startsWith('pmo.')) return 'pmo.enabled'
  if (capability.startsWith('meetings.')) return 'meetings.enabled'
  if (capability.startsWith('hr.')) return 'hr.enabled'
  if (capability === INTERNAL_NASQ_ACCESS) return 'chat.enabled'
  return null
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
  const needsWrite = write || WRITE_CAPABILITIES.has(capability)
  return hasFeature(identity, featureForCapability(capability), needsWrite)
}
