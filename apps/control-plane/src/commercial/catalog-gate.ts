import type { PoolClient } from 'pg'
import { catalogApplicationsFromSolution } from '@liwan/commercial-contracts/server'
import type { CatalogApplication } from '@liwan/commercial-contracts'
import { DERIVED_LIMITS } from './bundles.js'
import { CommercialHttpError } from './lifecycle.js'
import { USAGE_MAX_AGE_MS } from './usage.js'

export type CatalogGateCode =
  | 'catalog_app_in_use'
  | 'catalog_feature_removed'
  | 'catalog_limit_removed'
  | 'catalog_limit_below_usage'

export class CatalogGateError extends CommercialHttpError {
  readonly affected_count: number
  readonly details?: Record<string, unknown>

  constructor(code: CatalogGateCode, affectedCount: number, details?: Record<string, unknown>, message = code) {
    super(code, 409, undefined, [], { affected_count: String(affectedCount) })
    this.name = 'CatalogGateError'
    this.message = message
    this.affected_count = affectedCount
    if (details !== undefined) this.details = details
  }
}

export function catalogGatePayload(error: CatalogGateError): { code: string; affected_count: number; message: string } {
  return { code: error.code, affected_count: error.affected_count, message: error.message }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type BundleRow = {
  id: string
  status: string
  available: boolean
  selections: Array<{ app_id: string; feature_keys: string[] }> | null
  domain_limits: Record<string, number | null> | null
  catalog_release_id: string
}
type PlanRow = {
  id: string
  platform_limits: Record<string, number | null> | null
}
type SubRow = {
  id: string
  tenant_id: string | null
  snapshot: {
    bundle_revision_ids?: unknown
    terms_revision_id?: unknown
    entitlement?: {
      catalog_release_id?: unknown
      features?: Record<string, boolean | number | null>
    }
  } | null
}
type ReleaseRow = {
  id: string
  applications: CatalogApplication[]
}
type TermsRow = {
  id: string
  payload: {
    limits?: Record<string, number | null>
  } | null
}
type UsageRow = {
  tenant_id: string
  observed_at: Date | string
  freshness: string
  metrics: Record<string, unknown> | null
}

function appOwnedBySubscription(
  app: CatalogApplication,
  selectedApps: ReadonlySet<string>,
  features: Record<string, boolean | number | null>,
): boolean {
  return !app.selectable || selectedApps.has(app.id)
    || app.features.some(f => f.kind === 'boolean' && features[f.key] === true)
}

/**
 * Refuses publishing a candidate catalog that would break live published bundles, live published plans,
 * or active/past_due/trialing subscriptions (including lowering a limit ceiling below a tenant's live usage).
 */
export async function assertCatalogCompatible(
  client: Pick<PoolClient, 'query'>,
  nextSolution: Record<string, unknown>,
  version = 'candidate',
  now: Date = new Date(),
): Promise<void> {
  if (!nextSolution || typeof nextSolution !== 'object' || !Array.isArray(nextSolution.tiers) || nextSolution.tiers.length === 0) return
  const applications = catalogApplicationsFromSolution(
    nextSolution as Parameters<typeof catalogApplicationsFromSolution>[0],
    version,
  )
  if (!applications.length) return

  const derived = new Set<string>(DERIVED_LIMITS)
  const appIds = new Set<string>()
  const appBoolKeys = new Map<string, Set<string>>()
  const allBoolKeys = new Set<string>()
  const appLimitKeys = new Map<string, Set<string>>()
  const platformLimitKeys = new Set<string>()
  const allLimitKeys = new Set<string>()

  for (const app of applications) {
    appIds.add(app.id)
    const bools = new Set<string>()
    const limits = new Set<string>()
    for (const f of app.features) {
      if (f.kind === 'boolean') {
        bools.add(f.key)
        allBoolKeys.add(f.key)
      } else if (!derived.has(f.key)) {
        limits.add(f.key)
        allLimitKeys.add(f.key)
        if (!app.selectable) platformLimitKeys.add(f.key)
      }
    }
    appBoolKeys.set(app.id, bools)
    appLimitKeys.set(app.id, limits)
  }

  // 1) Active / past_due / trialing subscriptions with their applied snapshot.
  const subs = (await client.query(
    `SELECT s.id, s.tenant_id, sr.snapshot
     FROM subscriptions s
     JOIN subscription_revisions sr ON sr.id = s.applied_revision_id
     WHERE s.state IN ('active', 'past_due', 'trialing')
       AND s.applied_revision_id IS NOT NULL`,
  )).rows as SubRow[]

  const subBundleIds = new Map<string, string[]>()
  const referencedBundleIds = new Set<string>()
  const referencedReleaseIds = new Set<string>()
  const referencedTermsIds = new Set<string>()
  for (const sub of subs) {
    const rawIds = Array.isArray(sub.snapshot?.bundle_revision_ids) ? sub.snapshot!.bundle_revision_ids : []
    const ids = rawIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x))
    subBundleIds.set(sub.id, ids)
    for (const id of ids) referencedBundleIds.add(id)
    const relId = sub.snapshot?.entitlement?.catalog_release_id
    if (typeof relId === 'string' && UUID_RE.test(relId)) referencedReleaseIds.add(relId)
    const termsId = sub.snapshot?.terms_revision_id
    if (typeof termsId === 'string' && UUID_RE.test(termsId)) referencedTermsIds.add(termsId)
  }

  // 2) Published available bundles + any bundle revision referenced by a live subscription.
  const bundles = (await client.query(
    `SELECT id, status, available, selections, domain_limits, catalog_release_id
     FROM bundle_revisions
     WHERE (status = 'published' AND available = true)
        OR id = ANY($1::uuid[])`,
    [[...referencedBundleIds]],
  )).rows as BundleRow[]
  const bundleById = new Map(bundles.map(b => [b.id, b]))
  const liveBundles = bundles.filter(b => b.status === 'published' && b.available)
  for (const b of bundles) {
    if (typeof b.catalog_release_id === 'string' && UUID_RE.test(b.catalog_release_id)) {
      referencedReleaseIds.add(b.catalog_release_id)
    }
  }

  // 3) Published available plans.
  const plans = (await client.query(
    `SELECT id, platform_limits
     FROM plan_revisions
     WHERE status = 'published' AND available = true`,
  )).rows as PlanRow[]

  // 4) Pinned catalog releases and customer terms for live subscriptions.
  const releasesById = new Map<string, CatalogApplication[]>()
  if (subs.length > 0 && referencedReleaseIds.size > 0) {
    const relRows = (await client.query(
      `SELECT id, applications FROM catalog_releases WHERE id = ANY($1::uuid[])`,
      [[...referencedReleaseIds]],
    )).rows as ReleaseRow[]
    for (const r of relRows) {
      if (Array.isArray(r.applications)) releasesById.set(r.id, r.applications)
    }
  }
  const termsLimitsById = new Map<string, Record<string, number | null>>()
  if (subs.length > 0 && referencedTermsIds.size > 0) {
    const termsRows = (await client.query(
      `SELECT id, payload FROM customer_terms_revisions WHERE id = ANY($1::uuid[])`,
      [[...referencedTermsIds]],
    )).rows as TermsRow[]
    for (const t of termsRows) {
      if (t.payload?.limits && typeof t.payload.limits === 'object') {
        termsLimitsById.set(t.id, t.payload.limits)
      }
    }
  }

  // Precompute per-subscription bundles, selected apps, features, pinned catalog apps, and limit overrides.
  const subContexts = subs.map(sub => {
    const subBundles = (subBundleIds.get(sub.id) ?? [])
      .map(id => bundleById.get(id))
      .filter((b): b is BundleRow => Boolean(b))
    const selectedApps = new Set(subBundles.flatMap(b => (b.selections ?? []).map(sel => sel.app_id)))
    const features: Record<string, boolean | number | null> =
      sub.snapshot?.entitlement?.features && typeof sub.snapshot.entitlement.features === 'object'
        ? sub.snapshot.entitlement.features
        : {}
    const relId = typeof sub.snapshot?.entitlement?.catalog_release_id === 'string'
      ? sub.snapshot.entitlement.catalog_release_id
      : subBundles[0]?.catalog_release_id
    const pinnedApps = relId ? releasesById.get(relId) : undefined
    const termsId = typeof sub.snapshot?.terms_revision_id === 'string' ? sub.snapshot.terms_revision_id : undefined
    const termsLimits = termsId ? termsLimitsById.get(termsId) : undefined
    const overriddenLimitKeys = new Set<string>()
    for (const b of subBundles) {
      for (const k of Object.keys(b.domain_limits ?? {})) overriddenLimitKeys.add(k)
    }
    for (const k of Object.keys(termsLimits ?? {})) overriddenLimitKeys.add(k)
    return { sub, subBundles, selectedApps, features, pinnedApps, overriddenLimitKeys }
  })

  // Rule 1: catalog_app_in_use
  const removedAppAffected = new Set<string>()
  for (const bundle of liveBundles) {
    if ((bundle.selections ?? []).some(sel => !appIds.has(sel.app_id))) {
      removedAppAffected.add(`bundle:${bundle.id}`)
    }
  }
  for (const { sub, subBundles, selectedApps, features, pinnedApps } of subContexts) {
    const bundleUsesRemoved = subBundles.some(b => (b.selections ?? []).some(sel => !appIds.has(sel.app_id)))
    const pinnedUsesRemoved = pinnedApps
      ? pinnedApps.some(app => appOwnedBySubscription(app, selectedApps, features) && !appIds.has(app.id))
      : false
    if (bundleUsesRemoved || pinnedUsesRemoved) removedAppAffected.add(`subscription:${sub.id}`)
  }
  if (removedAppAffected.size > 0) throw new CatalogGateError('catalog_app_in_use', removedAppAffected.size)

  // Rule 2: catalog_feature_removed
  const removedFeatureAffected = new Set<string>()
  for (const bundle of liveBundles) {
    const missing = (bundle.selections ?? []).some(sel => {
      const bools = appBoolKeys.get(sel.app_id)
      return (sel.feature_keys ?? []).some(key => !bools?.has(key))
    })
    if (missing) removedFeatureAffected.add(`bundle:${bundle.id}`)
  }
  for (const { sub, subBundles, selectedApps, features, pinnedApps } of subContexts) {
    let affected = subBundles.some(b => (b.selections ?? []).some(sel => {
      const bools = appBoolKeys.get(sel.app_id)
      return (sel.feature_keys ?? []).some(key => !bools?.has(key))
    }))
    if (!affected) {
      const pinnedKeyApp = new Map<string, CatalogApplication>()
      if (pinnedApps) {
        for (const app of pinnedApps) {
          if (appOwnedBySubscription(app, selectedApps, features)) {
            for (const f of app.features) pinnedKeyApp.set(f.key, app)
          }
        }
      }
      for (const [key, value] of Object.entries(features)) {
        if (value !== true) continue
        const owner = pinnedKeyApp.get(key)
        if (owner) {
          if (!appBoolKeys.get(owner.id)?.has(key)) { affected = true; break }
        } else if (!allBoolKeys.has(key)) {
          affected = true; break
        }
      }
    }
    if (affected) removedFeatureAffected.add(`subscription:${sub.id}`)
  }
  if (removedFeatureAffected.size > 0) throw new CatalogGateError('catalog_feature_removed', removedFeatureAffected.size)

  // Rule 3: catalog_limit_removed
  const removedLimitAffected = new Set<string>()
  const bundleHasRemovedLimit = (bundle: BundleRow): boolean => {
    const selected = new Set((bundle.selections ?? []).map(sel => sel.app_id))
    for (const key of Object.keys(bundle.domain_limits ?? {})) {
      if (derived.has(key)) continue
      if (![...selected].some(appId => appLimitKeys.get(appId)?.has(key))) return true
    }
    return false
  }
  for (const bundle of liveBundles) {
    if (bundleHasRemovedLimit(bundle)) removedLimitAffected.add(`bundle:${bundle.id}`)
  }
  for (const plan of plans) {
    for (const key of Object.keys(plan.platform_limits ?? {})) {
      if (derived.has(key)) continue
      if (!platformLimitKeys.has(key)) {
        removedLimitAffected.add(`plan:${plan.id}`)
        break
      }
    }
  }
  for (const { sub, subBundles, selectedApps, features, pinnedApps } of subContexts) {
    let affected = subBundles.some(bundleHasRemovedLimit)
    if (!affected) {
      const sourceApps = pinnedApps ?? applications
      const unownedKeys = new Set<string>()
      const ownedKeyApp = new Map<string, CatalogApplication>()
      for (const app of sourceApps) {
        if (appOwnedBySubscription(app, selectedApps, features)) {
          for (const f of app.features) ownedKeyApp.set(f.key, app)
        } else {
          for (const f of app.features) unownedKeys.add(f.key)
        }
      }
      for (const [key, value] of Object.entries(features)) {
        if (derived.has(key) || typeof value !== 'number') continue
        if (unownedKeys.has(key)) continue
        const owner = ownedKeyApp.get(key)
        if (owner) {
          if (!appLimitKeys.get(owner.id)?.has(key)) { affected = true; break }
        } else if (!allLimitKeys.has(key)) {
          affected = true; break
        }
      }
    }
    if (affected) removedLimitAffected.add(`subscription:${sub.id}`)
  }
  if (removedLimitAffected.size > 0) throw new CatalogGateError('catalog_limit_removed', removedLimitAffected.size)

  // Rule 4: catalog_limit_below_usage
  const loweredChecks: Array<{ sub: SubRow; lowered: Array<{ key: string; ceiling: number }> }> = []
  for (const { sub, selectedApps, features, pinnedApps, overriddenLimitKeys } of subContexts) {
    const pinnedCeilings = new Map<string, number | null>()
    if (pinnedApps) {
      for (const pinnedApp of pinnedApps) {
        for (const pf of pinnedApp.features) {
          if (pf.kind !== 'limit') continue
          pinnedCeilings.set(pf.key, typeof pf.ceiling === 'number' && Number.isFinite(pf.ceiling) ? pf.ceiling : null)
        }
      }
    }
    const lowered: Array<{ key: string; ceiling: number }> = []
    for (const app of applications) {
      if (!appOwnedBySubscription(app, selectedApps, features)) continue
      for (const f of app.features) {
        if (f.kind !== 'limit' || derived.has(f.key)) continue
        const nextCeiling = typeof f.ceiling === 'number' && Number.isFinite(f.ceiling) ? f.ceiling : null
        if (nextCeiling === null) continue
        const pinnedCeiling = pinnedCeilings.get(f.key) ?? null
        const ceilingLowered =
          (pinnedCeiling === null && typeof nextCeiling === 'number')
          || (typeof pinnedCeiling === 'number' && typeof nextCeiling === 'number' && nextCeiling < pinnedCeiling)
        if (!ceilingLowered || overriddenLimitKeys.has(f.key)) continue
        const applied = features[f.key]
        if (applied === null || (typeof applied === 'number' && Number.isFinite(applied) && nextCeiling < applied)) {
          lowered.push({ key: f.key, ceiling: nextCeiling })
        }
      }
    }
    if (lowered.length > 0) loweredChecks.push({ sub, lowered })
  }
  if (!loweredChecks.length) return

  const tenantIds = [...new Set(
    loweredChecks
      .map(c => c.sub.tenant_id)
      .filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)),
  )]
  const usageByTenant = new Map<string, UsageRow>()
  if (tenantIds.length > 0) {
    const usageRows = (await client.query(
      `SELECT DISTINCT ON (tenant_id) tenant_id, observed_at, freshness, metrics
       FROM usage_snapshots
       WHERE tenant_id = ANY($1::uuid[])
       ORDER BY tenant_id, observed_at DESC, id DESC`,
      [tenantIds],
    )).rows as UsageRow[]
    for (const u of usageRows) usageByTenant.set(u.tenant_id, u)
  }

  const nowMs = now.getTime()
  const belowUsageAffected = new Set<string>()
  for (const { sub, lowered } of loweredChecks) {
    const usage = sub.tenant_id ? usageByTenant.get(sub.tenant_id) : undefined
    const observedMs = usage ? new Date(usage.observed_at).getTime() : Number.NaN
    const isFresh = Boolean(
      usage
      && usage.freshness === 'fresh'
      && Number.isFinite(observedMs)
      && nowMs - observedMs <= USAGE_MAX_AGE_MS,
    )
    for (const { key, ceiling } of lowered) {
      const used = usage?.metrics?.[key]
      if (!isFresh || typeof used !== 'number' || !Number.isFinite(used) || used > ceiling) {
        belowUsageAffected.add(sub.id)
        break
      }
    }
  }
  if (belowUsageAffected.size > 0) throw new CatalogGateError('catalog_limit_below_usage', belowUsageAffected.size)
}
