import type { PoolClient } from 'pg'
import { MAX_USERS, publicPricingSchema, type BundleRevision, type CatalogRelease, type Price, type PublicPricing } from '@liwan/commercial-contracts'
import { billingSettings } from '../commercial/billing-settings.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { loadPublicPlanOffer } from '../signup/offer.js'

const MB_PER_GB = 1024
const FOUNDATION_MODULES = new Set(['liwan_core', 'liwan_platform', 'liwan_api'])

function unavailable(): never { throw new CommercialHttpError('unavailable', 503) }

function findUnitPrice(prices: Price[], unit: 'month' | 'year', currency: string): number | undefined {
  const price = prices.find(p => p.cadence.unit === unit && p.cadence.count === 1 && p.amount.currency === currency)
  if (!price) return undefined
  return price.amount.minor / 10 ** price.amount.exponent
}

/** The amount of the plain monthly or yearly price in whole units, or unavailable: the site must never show a made-up number. */
function requireUnitPrice(prices: Price[], unit: 'month' | 'year', currency: string): number {
  const value = findUnitPrice(prices, unit, currency)
  if (value === undefined) unavailable()
  return value
}

/** Derives the included free base apps deterministically from the catalog release and the plan's included bundles. */
function deriveFreeApps(release: CatalogRelease, includedBundles: BundleRevision[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }

  for (const app of release.applications) {
    if (app.selectable) continue
    for (const feature of app.features) {
      if (feature.kind === 'boolean' && feature.key.endsWith('.enabled')) {
        push(feature.key.slice(0, -'.enabled'.length))
      }
    }
    if (app.id !== 'core') push(app.id)
  }

  for (const mod of release.base_modules ?? []) {
    if (FOUNDATION_MODULES.has(mod)) continue
    push(mod.replace(/^liwan_/, ''))
  }

  for (const bundle of includedBundles) {
    for (const sel of bundle.selections) push(sel.app_id)
  }

  return out
}

/**
 * The currently published offer as the marketing site reads it. It is built from the same published plan and bundles the
 * sign-up offers (so a price the visitor sees is the price sign-up will start from) plus the vendor's billing settings;
 * nothing here is typed in by hand.
 */
export async function loadPublicPricing(client: Pick<PoolClient, 'query'>, planId: string): Promise<PublicPricing> {
  const { plan, policy, release, includedBundles, optionalBundles } = await loadPublicPlanOffer(client, planId, { requireTrial: false })
  const settings = await billingSettings(client)
  if (settings.onboarding_currency !== plan.currency) unavailable()

  const currency = plan.currency
  const baseMonthly = requireUnitPrice(plan.prices, 'month', currency)
  const baseAnnual = findUnitPrice(plan.prices, 'year', currency) ?? null
  const hasAnnual = baseAnnual !== null
  const monthlyAndOptionalAnnual = (prices: Price[]) => ({
    monthly: requireUnitPrice(prices, 'month', currency),
    annual: hasAnnual ? requireUnitPrice(prices, 'year', currency) : null,
  })

  const appsById = new Map(release.applications.map(app => [app.id, app]))
  const gb = (mb: number) => mb / MB_PER_GB
  const perGb = requireUnitPrice(plan.storage_prices, 'month', currency)
  const blockGb = gb(plan.storage_step_mb)

  return publicPricingSchema.parse({
    schema_version: 1,
    currency,
    ...(policy.tax.kind === 'vat_exclusive'
      ? { tax: 'vat_exclusive' as const, tax_rate_bps: policy.tax.rate_bps }
      : { tax: 'none' as const }),
    trial_days: plan.trial_days,
    base: { monthly: baseMonthly, annual: baseAnnual },
    free: {
      users: plan.included_users,
      storage_gb: gb(plan.included_storage_mb),
      branches: plan.included_extra_branches,
      apps: deriveFreeApps(release, includedBundles),
    },
    apps: optionalBundles.map(bundle => {
      const id = bundle.selections[0]!.app_id
      const application = appsById.get(id)
      if (!application) unavailable()
      return {
        key: id,
        name_ar: application.name_ar,
        name_en: application.name_en,
        ...monthlyAndOptionalAnnual(bundle.prices),
      }
    }),
    extra_user: { ...monthlyAndOptionalAnnual(plan.user_prices), max_users: MAX_USERS },
    extra_storage: {
      per_gb_monthly: perGb,
      block_gb: blockGb,
      block_monthly: perGb * blockGb,
      step_gb: blockGb,
      step_gb_after: gb(plan.storage_step_threshold_mb),
      step_gb_large: gb(plan.storage_large_step_mb),
    },
    onboarding: { one_time: settings.onboarding_fee_minor / 10 ** settings.onboarding_exponent },
    refund_days: settings.refund_window_days,
  })
}
