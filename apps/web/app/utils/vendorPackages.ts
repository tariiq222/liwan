import { PACKAGE_LIMIT_MAX, packageInputSchema, type PackageInput } from '@nasq/commercial-contracts'
import { humanizeId } from './labelFallback'
import { safeReturnTo } from './safeReturnTo'
export type PackageCatalog = { id: string; version: string; status: string; solution: { base_modules?: string[]; tiers?: PackageTier[] } }
export type PackageTier = { id?: string; name?: string; modules?: string[]; features?: string[] }
export type PackageLimitDraft = { mode: '' | 'limited' | 'unlimited'; value: string }
export function packageLimitValue(draft: PackageLimitDraft): number | null {
  if (draft.mode === 'unlimited') return null
  const value = draft.value.trim()
  if (draft.mode !== 'limited' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > PACKAGE_LIMIT_MAX) throw new Error('invalid_limit')
  return Number(value)
}
export function packageLimitKeys(tier?: PackageTier) {
  return [...new Set(['users.limit', 'storage.limit_mb', ...(tier?.features ?? []).filter(item => item.startsWith('limit:')).map(item => item.slice(6))])]
}
const labelKeys: Record<string, Record<string, string>> = {
  tier: { core: 'core', projects: 'projects', people: 'people', messaging: 'messaging' },
  module: { nasq_core: 'core', nasq_platform: 'platform', nasq_api: 'api', nasq_pmo: 'projects', nasq_meetings: 'meetings', nasq_hr: 'people', nasq_chat: 'messaging' },
  feature: { 'boolean:pmo.enabled': 'projects', 'boolean:meetings.enabled': 'meetings', 'boolean:hr.enabled': 'hr', 'boolean:chat.enabled': 'chat', 'limit:users.limit': 'users', 'limit:storage.limit_mb': 'storage', 'limit:projects.max_projects': 'projectLimit' },
  limit: { 'users.limit': 'users', 'storage.limit_mb': 'storage', 'projects.max_projects': 'projects' },
}
export function packageLabel(kind: 'tier' | 'module' | 'feature' | 'limit', value: string, t: (key: string) => string): string {
  const key = labelKeys[kind]?.[value]
  if (key) return t(`vendor.packages.${kind === 'tier' ? 'tiers' : kind === 'module' ? 'apps' : kind === 'limit' ? 'limits' : 'features'}.${key}`)
  // A newer application's module id reads as its name; other unknown values stay as sent (Phase 3 catalog names).
  return kind === 'module' && /^(?:nasq|customer)_[a-z0-9_]+$/.test(value) ? humanizeId(value) : value
}
export function packageListReturnTo(value: unknown): string {
  const safe = safeReturnTo(value, '/vendor/catalog', ['/vendor/catalog'])
  return new URL(safe, 'http://nasq.local').pathname.replace(/\/$/, '') === '/vendor/catalog' ? safe : '/vendor/catalog'
}
export function packageFormInput(draft: Omit<PackageInput, 'limits'>, limits: Record<string, PackageLimitDraft>, keys: string[]): PackageInput {
  return packageInputSchema.parse({ ...draft, limits: Object.fromEntries(keys.map(key => { if (!limits[key]) throw new Error('invalid_limit'); return [key, packageLimitValue(limits[key])] })) })
}
export function packageMatchesStatus(item: { status: string; available: boolean }, status: string): boolean {
  if (!status) return true
  if (status === 'published') return item.status === 'published' && item.available
  if (status === 'unavailable') return item.status === 'published' && !item.available
  return item.status === status
}
