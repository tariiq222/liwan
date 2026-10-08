import { createHash } from 'node:crypto'
import { canonicalJson } from './calendar.js'
import { parseCatalogTiers } from './feature-descriptor.js'
import type { CatalogApplication, CatalogFeature, CatalogRelease } from './types.js'

type SolutionTier = { id: string; name?: string; modules?: string[]; features?: string[] }
type Solution = { schema_version?: unknown; descriptor_grammar?: unknown; base_modules?: string[]; tiers: SolutionTier[] }

const NAMES: Record<string, [string, string]> = {
  core: ['المنصة', 'Platform'],
  projects: ['المشاريع والاجتماعات', 'Projects & meetings'],
  people: ['الموارد البشرية', 'People'],
  messaging: ['المحادثات', 'Messaging'],
}
const ENFORCEMENT: Record<string, string[]> = {
  'users.limit': ['nasq_platform.res_users.users.limit'],
  'storage.limit_mb': ['nasq_platform.ir_attachment.storage.limit_mb'],
  'branches.extra_limit': ['nasq_platform.tenant_profile._nasq_apply_branches'],
  'pmo.enabled': ['nasq_api.requires_feature:pmo.enabled'],
  'meetings.enabled': ['nasq_api.requires_feature:meetings.enabled'],
  'projects.max_projects': ['nasq_pmo.project_project._nasq_claim_projects'],
  'hr.enabled': ['nasq_api.requires_feature:hr.enabled'],
  'chat.enabled': ['nasq_api.requires_feature:chat.enabled'],
}
/** An application's `<app>.enabled` key is gated by the shared feature check unless an entry above says otherwise. */
export function enforcementRefs(key: string): string[] {
  const explicit = ENFORCEMENT[key]
  if (explicit) return explicit
  return /^[a-z][a-z0-9_]*\.enabled$/.test(key) ? [`nasq_api.requires_feature:${key}`] : []
}
const PLATFORM_EXTRA = ['branches.extra_limit']

export function catalogApplicationsFromSolution(solution: Solution, _version: string): CatalogApplication[] {
  void _version
  // One shared parse validates structure, schema version and every composed
  // descriptor (kind-aware required platform keys) before anything is emitted.
  const parsed = parseCatalogTiers(solution)
  const base = [...(solution.base_modules ?? [])].sort()
  return solution.tiers.map((tier, index) => {
    const core = tier.id === 'core'
    // A new application is named by its catalog tier until it ships translations (Phase 4).
    const [name_ar, name_en] = NAMES[tier.id] ?? [tier.name || tier.id, tier.name || tier.id]
    const own = parsed.tiers[index]!.own
    // Schema-2 catalogs declare the platform limit themselves; do not duplicate it.
    const extra = core ? PLATFORM_EXTRA.filter(spec => !own.some(d => d.key === spec)) : []
    const specs: Array<{ kind: 'boolean' | 'limit'; key: string; ceiling?: number }> = [
      ...own.map(d => ({ kind: d.kind, key: d.key, ...(typeof d.value === 'number' ? { ceiling: d.value } : {}) })),
      ...extra.map(key => ({ kind: 'limit' as const, key })),
    ]
    return {
      id: tier.id, name_ar, name_en,
      modules: core ? base : [...(tier.modules ?? [])].sort(),
      requires_apps: [], conflicts_with_apps: [], selectable: !core,
      features: specs.map(({ kind, key, ceiling }): CatalogFeature => ({
        key, kind, selectable: kind === 'boolean' && !core, requires: [], enforcement_refs: enforcementRefs(key),
        // Emitted only when the descriptor carries a value; never defaulted.
        ...(ceiling !== undefined ? { ceiling } : {}),
      })),
    }
  })
}

const uniqSorted = (a: string[]) => [...new Set(a)].sort()
export function normalizeRelease(release: CatalogRelease): CatalogRelease {
  return {
    ...release,
    base_modules: release.base_modules ? uniqSorted(release.base_modules) : undefined,
    applications: [...release.applications].sort((a, b) => a.id.localeCompare(b.id)).map(app => ({
      ...app, modules: uniqSorted(app.modules), requires_apps: uniqSorted(app.requires_apps),
      conflicts_with_apps: uniqSorted(app.conflicts_with_apps),
      features: [...app.features].sort((a, b) => a.key.localeCompare(b.key)).map(f => ({
        ...f, requires: uniqSorted(f.requires), enforcement_refs: uniqSorted(f.enforcement_refs),
      })),
    })),
  }
}
export function catalogDigest(release: CatalogRelease): string {
  return createHash('sha256').update(canonicalJson(normalizeRelease(release))).digest('hex')
}
