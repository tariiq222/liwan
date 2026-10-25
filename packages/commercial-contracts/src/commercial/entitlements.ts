import { createHash } from 'node:crypto'
import { canonicalJson } from './calendar.js'
import { admitsRequiredAdmin, USERS_LIMIT_KEY } from './schemas.js'
import { CommercialError } from './types.js'
import type { BundleRevision, CapacityMap, CatalogApplication, CatalogRelease, CustomerTermsRevision, EntitlementSnapshot, PlanRevision } from './types.js'

export { CommercialError }
/** /2: modules are the whole release (every application is installed in every tenant) and
 * features carry every key of every release application (spec 3.6, rulings E2/E3/E6). */
export const COMPILER_VERSION = 'commercial-compiler/3'

export function compileEntitlements(input: {
  release: CatalogRelease; plan: PlanRevision; bundles: BundleRevision[]; terms: CustomerTermsRevision | null
  quantities: { users: number; storage_mb: number }
}): EntitlementSnapshot {
  const { release, plan, bundles, terms, quantities } = input
  if (![quantities.users, quantities.storage_mb].every(v => Number.isSafeInteger(v) && v >= 0))
    throw new CommercialError('invalid_quantity', 'quantities')
  const apps = new Map(release.applications.map(a => [a.id, a]))
  const coreApps = release.applications.filter(a => !a.selectable)

  for (const b of bundles) if (b.catalog_release_id !== release.id) throw new CommercialError('catalog_release_mismatch', 'bundle_revision_ids')
  const allowed = new Set([...plan.included_bundle_revision_ids, ...plan.optional_bundle_revision_ids])
  for (const b of bundles) if (!allowed.has(b.id)) throw new CommercialError('bundle_not_allowed', 'bundle_revision_ids')
  const present = new Set(bundles.map(b => b.id))
  for (const id of plan.included_bundle_revision_ids) if (!present.has(id)) throw new CommercialError('bundle_missing', 'bundle_revision_ids')

  // Selections
  const selectedApps = new Set<string>()
  const booleanFeatures = new Set<string>()
  for (const b of bundles) for (const sel of b.selections) {
    const app = apps.get(sel.app_id)
    if (!app) throw new CommercialError('unknown_app', 'selections')
    if (!app.selectable) throw new CommercialError('app_not_selectable', 'selections')
    selectedApps.add(app.id)
    // The list is validated for shape so existing rows parse, but it is no longer the grant unit.
    for (const key of sel.feature_keys) {
      const f = app.features.find(x => x.key === key)
      if (!f || !f.selectable || f.kind !== 'boolean') throw new CommercialError('feature_not_selectable', 'selections')
    }
  }
  // Selecting an application grants every selectable boolean it owns (spec §4.2.7): the
  // customer buys the application whole, so its internal feature keys must not be a second
  // purchasing decision stored beside it.
  for (const id of selectedApps) for (const f of (apps.get(id) as CatalogApplication).features)
    if (f.kind === 'boolean' && f.selectable) booleanFeatures.add(f.key)

  // Dependency cycles across selected apps' requires graph
  const state = new Map<string, number>()
  const visit = (id: string): void => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) throw new CommercialError('dependency_cycle', 'selections')
    state.set(id, 1)
    for (const dep of apps.get(id)?.requires_apps ?? []) if (apps.has(dep)) visit(dep)
    state.set(id, 2)
  }
  for (const id of [...selectedApps].sort()) visit(id)

  const availableApps = new Set([...selectedApps, ...coreApps.map(a => a.id)])
  for (const id of selectedApps) {
    const app = apps.get(id) as CatalogApplication
    for (const dep of app.requires_apps) if (!availableApps.has(dep)) throw new CommercialError('dependency_missing', 'selections')
    for (const other of app.conflicts_with_apps) if (selectedApps.has(other)) throw new CommercialError('app_conflict', 'selections')
  }
  const knownBool = new Set([...booleanFeatures, ...coreApps.flatMap(a => a.features.filter(f => f.kind === 'boolean').map(f => f.key))])
  for (const id of selectedApps) for (const f of (apps.get(id) as CatalogApplication).features)
    if (booleanFeatures.has(f.key)) for (const r of f.requires) if (!knownBool.has(r)) throw new CommercialError('dependency_missing', 'selections')

  // Modules: the whole release. They decide nothing about access; features do.
  const modules = [...new Set([...(release.base_modules ?? []), ...release.applications.flatMap(a => a.modules)])].sort()

  // Limits
  const platformKeys = new Set(coreApps.flatMap(a => a.features.filter(f => f.kind === 'limit').map(f => f.key)))
  const domainKeys = new Set([...selectedApps].flatMap(id => (apps.get(id) as CatalogApplication).features.filter(f => f.kind === 'limit').map(f => f.key)))
  const features: Record<string, boolean | number | null> = {}
  for (const k of booleanFeatures) features[k] = true

  const domain: CapacityMap = {}
  for (const b of bundles) for (const [k, v] of Object.entries(b.domain_limits)) {
    if (platformKeys.has(k)) throw new CommercialError('invalid_limit_scope', 'domain_limits')
    if (!domainKeys.has(k)) throw new CommercialError('limit_not_supported', 'domain_limits')
    if (k in domain && domain[k] !== v) throw new CommercialError('ambiguous_limit', 'domain_limits')
    domain[k] = v
  }
  // Users and storage are customer-chosen quantities, never plan limits: one source of truth.
  const derived = new Set([USERS_LIMIT_KEY, 'storage.limit_mb', 'branches.extra_limit'])
  for (const k of Object.keys(plan.platform_limits)) {
    if (derived.has(k)) throw new CommercialError('platform_limit_derived', 'platform_limits')
    if (!platformKeys.has(k)) throw new CommercialError('limit_not_supported', 'platform_limits')
  }
  // Code never invents a commercial value: every other platform limit the plan does not derive is set by it
  // (an explicit null means unlimited).
  for (const k of platformKeys) if (!derived.has(k) && !Object.hasOwn(plan.platform_limits, k)) throw new CommercialError('platform_limit_missing', 'platform_limits')
  const platform: CapacityMap = { ...plan.platform_limits, [USERS_LIMIT_KEY]: quantities.users, 'storage.limit_mb': quantities.storage_mb }
  Object.assign(features, domain, platform)
  for (const [k, v] of Object.entries(terms?.limits ?? {})) {
    // Capacity is the customer's chosen quantity, changed only by a new subscription quote;
    // a terms revision may not grant or remove users/storage outside that agreement.
    if (derived.has(k)) throw new CommercialError('platform_limit_derived', 'limits')
    if (!platformKeys.has(k) && !domainKeys.has(k)) throw new CommercialError('limit_not_supported', 'limits')
    features[k] = v
  }
  if (!admitsRequiredAdmin(features[USERS_LIMIT_KEY]))
    throw new CommercialError('users_limit_admin_required', Object.hasOwn(terms?.limits ?? {}, USERS_LIMIT_KEY) ? 'limits' : 'quantities')
  const branches = terms?.extra_branches_limit !== undefined ? terms.extra_branches_limit : plan.extra_branches_limit
  features['branches.extra_limit'] = branches

  // Release-complete: every key of every application is present. A left-out application
  // is closed (booleans false, limits 0); a core or included one keeps the catalog value
  // for a limit nobody set. Odoo refuses a policy write that misses a key.
  for (const app of release.applications) for (const f of app.features) {
    if (Object.hasOwn(features, f.key)) continue
    const open = !app.selectable || selectedApps.has(app.id)
    features[f.key] = f.kind === 'boolean' ? open && !f.selectable : open ? (f.ceiling ?? null) : 0
  }

  const sorted = Object.fromEntries(Object.keys(features).sort().map(k => [k, features[k] as boolean | number | null]))
  const digest = createHash('sha256').update(canonicalJson({
    catalog_release_id: release.id, modules, features: sorted, compiler_version: COMPILER_VERSION,
  })).digest('hex')
  return { catalog_release_id: release.id, modules, features: sorted, compiler_version: COMPILER_VERSION, digest }
}
