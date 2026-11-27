import type { PoolClient } from 'pg'
import {
  signupOfferSchema,
  type BundleRevision,
  type CatalogApplication,
  type CatalogRelease,
  type PlanRevision,
  type Price,
  type PricingPolicy,
  type SignupOffer,
} from '@liwan/commercial-contracts'
import { compileEntitlements, isSellable } from '@liwan/commercial-contracts/server'
import { bundleRevision, loadRelease } from '../commercial/bundles.js'
import { latestPublishedRelease } from '../commercial/catalog-releases.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { planRevision } from '../commercial/plans.js'
import { policyWire } from '../commercial/policies.js'

export const signupCadence = { unit: 'month', count: 1 } as const

type LoadedPublicPlanOffer<TOffer extends SignupOffer | null> = {
  offer: TOffer
  plan: PlanRevision
  policy: PricingPolicy
  release: CatalogRelease
  includedBundles: BundleRevision[]
  optionalBundles: BundleRevision[]
}

function unavailable(): never { throw new CommercialHttpError('unavailable', 503) }

function monthlyPriceIn(prices: Price[], currency: string, exponent?: number) {
  return prices.find(
    price => price.cadence.unit === signupCadence.unit
      && price.cadence.count === signupCadence.count
      && price.amount.currency === currency
      && (exponent === undefined || price.amount.exponent === exponent),
  )
}

function compileOrUnavailable(input: Parameters<typeof compileEntitlements>[0]) {
  try { return compileEntitlements(input) } catch { unavailable() }
}

function assertAppEnabled(app: CatalogApplication, features: Record<string, boolean | number | null>): void {
  const selectableBools = app.features.filter(feature => feature.kind === 'boolean' && feature.selectable)
  if (!selectableBools.length || !selectableBools.every(feature => features[feature.key] === true)) unavailable()
}

function extractAppLimits(app: CatalogApplication, features: Record<string, boolean | number | null>): Record<string, number | null> {
  const limits: Record<string, number | null> = {}
  for (const feature of app.features) {
    if (feature.kind !== 'limit') continue
    const value = features[feature.key]
    if (value !== null && typeof value !== 'number') unavailable()
    limits[feature.key] = value
  }
  return limits
}

export async function loadPublicPlanOffer(client: Pick<PoolClient, 'query'>, planId: string, opts: { requireTrial: true }): Promise<LoadedPublicPlanOffer<SignupOffer>>
export async function loadPublicPlanOffer(client: Pick<PoolClient, 'query'>, planId: string, opts: { requireTrial: false }): Promise<LoadedPublicPlanOffer<null>>
export async function loadPublicPlanOffer(client: Pick<PoolClient, 'query'>, planId: string, opts: { requireTrial: boolean }): Promise<LoadedPublicPlanOffer<SignupOffer | null>>
/**
 * The currently published public revision of a plan, along with its approved pricing policy, catalog release, and
 * included/optional bundles. Sign-up requires `trial_days >= 1`; public pricing may also read plans with `trial_days = 0`.
 */
export async function loadPublicPlanOffer(
  client: Pick<PoolClient, 'query'>,
  planId: string,
  opts: { requireTrial: boolean },
): Promise<LoadedPublicPlanOffer<SignupOffer | null>> {
  const row = (await client.query(`SELECT r.*,
      p.id AS _policy_id, p.timezone AS _policy_timezone, p.rounding AS _policy_rounding,
      p.tax_kind AS _policy_tax_kind, p.tax_rate_bps AS _policy_tax_rate_bps, p.currency AS _policy_currency
    FROM plan_revisions r
    JOIN pricing_policy_revisions p ON p.id=r.policy_revision_id AND p.status='approved'
    WHERE r.plan_id=$1 AND r.status='published' AND r.available AND r.audience->>'kind'='public'
      AND ($2::boolean IS FALSE OR r.trial_days >= 1)
    ORDER BY r.version DESC LIMIT 1 FOR SHARE OF r`, [planId, opts.requireTrial])).rows[0]
  if (!row) unavailable()

  const plan = planRevision(row)
  if (row._policy_currency !== plan.currency) unavailable()
  const policy = policyWire({
    id: row._policy_id,
    timezone: row._policy_timezone,
    rounding: row._policy_rounding,
    tax_kind: row._policy_tax_kind,
    tax_rate_bps: row._policy_tax_rate_bps,
  })

  const baseMonthly = monthlyPriceIn(plan.prices, plan.currency)
  if (!baseMonthly || baseMonthly.amount.minor < 0) unavailable()
  const exponent = baseMonthly.amount.exponent

  const allBundleIds = [...new Set([...plan.included_bundle_revision_ids, ...plan.optional_bundle_revision_ids])]
  const bundleRows = allBundleIds.length
    ? (await client.query(`SELECT * FROM bundle_revisions
        WHERE id=ANY($1::uuid[]) AND status='published' AND available AND audience->>'kind'='public'
        FOR SHARE`, [allBundleIds])).rows
    : []
  const byId = new Map(bundleRows.map(bundleRow => {
    const rev = bundleRevision(bundleRow)
    return [rev.id, rev] as const
  }))

  const includedBundles: BundleRevision[] = []
  const includedAppIds: string[] = []
  const includedAppIdSet = new Set<string>()
  for (const id of plan.included_bundle_revision_ids) {
    const bundle = byId.get(id)
    if (!bundle) unavailable()
    includedBundles.push(bundle)
    for (const sel of bundle.selections) {
      if (!includedAppIdSet.has(sel.app_id)) {
        includedAppIdSet.add(sel.app_id)
        includedAppIds.push(sel.app_id)
      }
    }
  }

  const optionalBundles: BundleRevision[] = []
  const optionalAppIdSet = new Set<string>()
  for (const id of plan.optional_bundle_revision_ids) {
    const bundle = byId.get(id)
    if (!bundle) continue
    if (bundle.selections.length !== 1) unavailable()
    const appId = bundle.selections[0]!.app_id
    if (includedAppIdSet.has(appId) || optionalAppIdSet.has(appId)) unavailable()
    optionalAppIdSet.add(appId)
    optionalBundles.push(bundle)
  }

  const loadedBundles = [...includedBundles, ...optionalBundles]
  let release: CatalogRelease
  if (loadedBundles.length > 0) {
    const releaseIds = new Set(loadedBundles.map(bundle => bundle.catalog_release_id))
    if (releaseIds.size !== 1) unavailable()
    try { release = await loadRelease(client, loadedBundles[0]!.catalog_release_id) } catch { unavailable() }
  } else {
    const latest = await latestPublishedRelease(client)
    if (!latest) unavailable()
    release = latest
  }

  const appsById = new Map(release.applications.map(app => [app.id, app]))
  for (const appId of [...includedAppIds, ...optionalAppIdSet]) {
    const app = appsById.get(appId)
    if (!app || !isSellable(app)) unavailable()
  }

  const quantities = { users: plan.included_users, storage_mb: plan.included_storage_mb }
  const includedEntitlement = compileOrUnavailable({ release, plan, bundles: includedBundles, terms: null, quantities })
  const includedApps = includedAppIds.map(id => {
    const app = appsById.get(id)!
    assertAppEnabled(app, includedEntitlement.features)
    return {
      id,
      name_ar: app.name_ar,
      name_en: app.name_en,
      limits: extractAppLimits(app, includedEntitlement.features),
    }
  })

  const optionalApps = optionalBundles.map(bundle => {
    const id = bundle.selections[0]!.app_id
    const app = appsById.get(id)!
    const amount = monthlyPriceIn(bundle.prices, plan.currency, exponent)?.amount
    if (!amount || amount.minor < 0) unavailable()
    const { features } = compileOrUnavailable({ release, plan, bundles: [...includedBundles, bundle], terms: null, quantities })
    assertAppEnabled(app, features)
    return {
      id,
      name_ar: app.name_ar,
      name_en: app.name_en,
      monthly_minor: amount.minor,
      limits: extractAppLimits(app, features),
    }
  })

  if (optionalBundles.length > 0) {
    compileOrUnavailable({ release, plan, bundles: [...includedBundles, ...optionalBundles], terms: null, quantities })
  }

  const offer = opts.requireTrial
    ? signupOfferSchema.parse({
        offer_revision: plan.id,
        plan_name: plan.name,
        trial_days: plan.trial_days,
        currency: plan.currency,
        currency_exponent: exponent,
        base_monthly_minor: baseMonthly.amount.minor,
        tax: policy.tax,
        included_users: plan.included_users,
        included_storage_mb: plan.included_storage_mb,
        included_extra_branches: plan.included_extra_branches,
        included_apps: includedApps,
        apps: optionalApps,
      })
    : null

  return { offer, plan, policy, release, includedBundles, optionalBundles }
}

/** The offer of a plan for self-service signup: latest published, available public revision with `trial_days >= 1`. */
export async function loadSignupOffer(client: Pick<PoolClient, 'query'>, planId: string): Promise<LoadedPublicPlanOffer<SignupOffer>> {
  return loadPublicPlanOffer(client, planId, { requireTrial: true })
}
