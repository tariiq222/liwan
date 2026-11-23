import { humanizeId } from '@liwan/ui/app/utils/humanizeId'

const labelKeys: Record<string, Record<string, string>> = {
  module: { liwan_core: 'core', liwan_platform: 'platform', liwan_api: 'api', liwan_pmo: 'projects', liwan_meetings: 'meetings', liwan_hr: 'people', liwan_chat: 'messaging' },
  feature: { 'boolean:pmo.enabled': 'projects', 'boolean:meetings.enabled': 'meetings', 'boolean:hr.enabled': 'hr', 'boolean:chat.enabled': 'chat', 'limit:users.limit': 'users', 'limit:storage.limit_mb': 'storage', 'limit:projects.max_projects': 'projectLimit' },
}

/** A catalog value's readable name: an application module or a feature maps to its locale key, and anything else passes through. */
export function catalogLabel(kind: 'module' | 'feature', value: string, t: (key: string) => string): string {
  const key = labelKeys[kind]?.[value]
  if (key) return t(`vendor.catalog.labels.${kind === 'module' ? 'apps' : 'features'}.${key}`)
  // A newer application's module id reads as its name; other unknown values stay as sent.
  return kind === 'module' && /^(?:liwan|customer)_[a-z0-9_]+$/.test(value) ? humanizeId(value) : value
}
