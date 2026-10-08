import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution, catalogDigest } from '../commercial/catalog.js'
import { CommercialError, compileEntitlements } from '../commercial/entitlements.js'
import type { BundleRevision, CatalogRelease, PlanRevision } from '../commercial/types.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const solution = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform.json', import.meta.url), 'utf8'))
function fixture() {
  const release: CatalogRelease = { id: id(1), version: 'v1', source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64), applications: catalogApplicationsFromSolution(solution, 'v1') }
  const bundle = (n: number, app: string, keys: string[], limits = {}): BundleRevision => ({ id: id(n), bundle_id: id(n + 20), version: 1, edit_revision: 1, name: app, description: app, audience: { kind: 'public' }, status: 'published', available: true, catalog_release_id: release.id, selections: [{ app_id: app, feature_keys: keys }], domain_limits: limits, prices: [] })
  const bundles = [bundle(2, 'projects', ['pmo.enabled', 'meetings.enabled'], { 'projects.max_projects': 0 }), bundle(3, 'people', ['hr.enabled'])]
  const plan: PlanRevision = { id: id(4), plan_id: id(5), version: 1, edit_revision: 1, name: 'Plan', status: 'published', available: true, audience: { kind: 'public' }, term_months: 12, prices: [], platform_limits: { 'users.limit': 20, 'storage.limit_mb': null }, included_bundle_revision_ids: [], optional_bundle_revision_ids: bundles.map(b => b.id), included_extra_branches: 1, extra_branch_prices: [], extra_branches_limit: 8, policy_revision_id: id(6), currency: 'SAR', trial_days: 0, grace_days: 0, auto_suspend: false, auto_renew_allowed: false }
  return { release, plan, bundles, terms: null }
}

describe('commercial catalog and entitlement compiler', () => {
  it('maps the checked-in composition into four bilingual applications with enforcement refs', () => {
    const apps = fixture().release.applications
    expect(apps.map(a => a.id)).toEqual(['core', 'projects', 'people', 'messaging'])
    expect(apps[0].name_ar).toBe('المنصة')
    expect(apps[1].modules).toEqual(['nasq_meetings', 'nasq_pmo'])
    expect(apps[1].features.map(f => f.key)).toEqual(['pmo.enabled', 'meetings.enabled', 'projects.max_projects'])
    expect(apps.flatMap(a => a.features).every(f => f.enforcement_refs.length > 0)).toBe(true)
    expect(apps[0].features.every(f => !f.selectable)).toBe(true)
  })
  it('installs the whole release, keeps 0/null, and overrides only explicit limits', () => {
    const input = fixture()
    const result = compileEntitlements({ ...input, terms: { id: id(9), customer_id: id(10), reason: 'Special terms', limits: { 'users.limit': 0 } } })
    expect(result.modules).toEqual(['nasq_api', 'nasq_chat', 'nasq_core', 'nasq_hr', 'nasq_meetings', 'nasq_platform', 'nasq_pmo'])
    expect(result.features).toEqual({ 'branches.extra_limit': 8, 'chat.enabled': false, 'hr.enabled': true, 'meetings.enabled': true, 'pmo.enabled': true, 'projects.max_projects': 0, 'storage.limit_mb': null, 'users.limit': 0 })
    expect(result.compiler_version).toBe('commercial-compiler/2')
    expect(input.plan.platform_limits['users.limit']).toBe(20)
  })
  it('closes every application the plan leaves out (booleans false, limits 0)', () => {
    const input = fixture()
    input.plan.optional_bundle_revision_ids = [input.bundles[1]!.id]
    const result = compileEntitlements({ ...input, bundles: [input.bundles[1]!] })
    expect(result.features).toEqual({ 'branches.extra_limit': 8, 'chat.enabled': false, 'hr.enabled': true, 'meetings.enabled': false, 'pmo.enabled': false, 'projects.max_projects': 0, 'storage.limit_mb': null, 'users.limit': 20 })
    expect(result.modules).toEqual(compileEntitlements(fixture()).modules)
  })
  it('keeps the catalog value for an included application limit no bundle sets', () => {
    const input = fixture()
    input.bundles[0]!.domain_limits = {}
    expect(compileEntitlements(input).features['projects.max_projects']).toBeNull()
  })
  it('closes an included application boolean the bundle did not select', () => {
    const input = fixture()
    input.bundles[0]!.selections[0]!.feature_keys = ['pmo.enabled']
    expect(compileEntitlements(input).features['meetings.enabled']).toBe(false)
  })
  it('is deterministic across bundle, selection, feature and object-key ordering', () => {
    const input = fixture()
    const first = compileEntitlements(input)
    const other = structuredClone(input)
    other.bundles.reverse(); other.bundles.forEach(b => b.selections.reverse().forEach(s => s.feature_keys.reverse()))
    other.release.applications.reverse()
    expect(compileEntitlements(other).digest).toBe(first.digest)
    expect(catalogDigest(other.release)).toBe(catalogDigest(input.release))
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/)
  })
  it.each(['missing', 'users.limit'])('rejects an unsupported/nonselectable feature %s', key => {
    const input = fixture(); input.bundles[0].selections[0].feature_keys = [key]
    expect(() => compileEntitlements(input)).toThrow('feature_not_selectable')
  })
  it('rejects selecting the always-included core as a bundle app', () => {
    const input = fixture(); input.bundles[0].selections = [{ app_id: 'core', feature_keys: [] }]
    expect(() => compileEntitlements(input)).toThrow('app_not_selectable')
  })
  it('rejects missing app dependencies, feature dependencies, conflicts and cycles', () => {
    let input = fixture(); input.release.applications.find(a => a.id === 'projects')!.requires_apps = ['messaging']
    expect(() => compileEntitlements(input)).toThrow('dependency_missing')
    input = fixture(); input.release.applications.find(a => a.id === 'projects')!.features[0].requires = ['chat.enabled']
    expect(() => compileEntitlements(input)).toThrow('dependency_missing')
    input = fixture(); input.release.applications.find(a => a.id === 'projects')!.conflicts_with_apps = ['people']
    expect(() => compileEntitlements(input)).toThrow('app_conflict')
    input = fixture(); input.release.applications.find(a => a.id === 'projects')!.requires_apps = ['people']; input.release.applications.find(a => a.id === 'people')!.requires_apps = ['projects']
    expect(() => compileEntitlements(input)).toThrow('dependency_cycle')
  })
  it('rejects inconsistent releases, disallowed bundles and missing included bundles', () => {
    let input = fixture(); input.bundles[0].catalog_release_id = id(99)
    expect(() => compileEntitlements(input)).toThrow('catalog_release_mismatch')
    input = fixture(); input.plan.optional_bundle_revision_ids = []
    expect(() => compileEntitlements(input)).toThrow('bundle_not_allowed')
    input = fixture(); input.plan.included_bundle_revision_ids = [id(99)]
    expect(() => compileEntitlements(input)).toThrow('bundle_missing')
  })
  it('rejects conflicting domain limits even with customer terms; allows identical limits', () => {
    const input = fixture(); input.bundles[1].domain_limits = { 'projects.max_projects': null }
    expect(() => compileEntitlements(input)).toThrow('ambiguous_limit')
    input.bundles[1].domain_limits = { 'projects.max_projects': 0 }
    expect(compileEntitlements(input).features['projects.max_projects']).toBe(0)
  })
  it('rejects platform capacities in bundles and unknown capacities', () => {
    const input = fixture(); input.bundles[0].domain_limits = { 'users.limit': 2 }
    expect(() => compileEntitlements(input)).toThrow('invalid_limit_scope')
    input.bundles[0].domain_limits = { 'unknown.limit': 2 }
    expect(() => compileEntitlements(input)).toThrow('limit_not_supported')
  })
  it('exposes structured error codes and field', () => {
    const error = new CommercialError('dependency_missing', 'selections')
    expect(error.code).toBe('dependency_missing'); expect(error.field).toBe('selections')
  })
  it('refuses a plan that leaves a platform limit unset, and allows an explicit null', () => {
    const input = fixture()
    input.plan.platform_limits = { 'users.limit': 5 }
    expect(() => compileEntitlements(input)).toThrowError(expect.objectContaining({ code: 'platform_limit_missing', field: 'platform_limits' }))
    input.plan.platform_limits = {}
    expect(() => compileEntitlements(input)).toThrowError(expect.objectContaining({ code: 'platform_limit_missing' }))
    input.plan.platform_limits = { 'users.limit': null, 'storage.limit_mb': null }
    expect(compileEntitlements(input).features['users.limit']).toBeNull()
  })
  it('opens a non-selectable boolean of a core or included application', () => {
    const input = fixture()
    const core = input.release.applications.find(a => !a.selectable)!
    core.features.push({ ...core.features[0]!, key: 'core.always', kind: 'boolean', selectable: false, ceiling: null })
    expect(compileEntitlements(input).features['core.always']).toBe(true)
  })
  it('compiles the real v3 catalog into exactly the eight policy keys', () => {
    const v3 = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform_v3.json', import.meta.url), 'utf8'))
    const input = fixture()
    input.release.applications = catalogApplicationsFromSolution(v3, 'v3')
    input.plan.platform_limits = { 'users.limit': 20, 'storage.limit_mb': null }
    expect(compileEntitlements(input).features).toEqual({ 'branches.extra_limit': 8, 'chat.enabled': false, 'hr.enabled': true, 'meetings.enabled': true, 'pmo.enabled': true, 'projects.max_projects': 0, 'storage.limit_mb': null, 'users.limit': 20 })
  })
})
