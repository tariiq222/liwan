import type { PoolClient } from 'pg'
import { MAX_USERS, publicPricingSchema, type Price, type PublicPricing } from '@liwan/commercial-contracts'
import { billingSettings } from '../commercial/billing-settings.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'
import { loadSignupOffer } from '../signup/offer.js'

const MB_PER_GB = 1024
/** The always-included base of release 1 (owner decision: tasks, chat, documents, meetings, operations and the AI assistant). */
export const FREE_BASE_APPS = ['tasks', 'chat', 'documents', 'meetings', 'operations', 'ai']

function unavailable(): never { throw new CommercialHttpError('unavailable', 503) }

/** The amount of the plain monthly or yearly price in whole units, or unavailable: the site must never show a made-up number. */
function unitPrice(prices: Price[], unit: 'month' | 'year'): number {
  const price = prices.find(p => p.cadence.unit === unit && p.cadence.count === 1 && p.amount.currency === 'SAR')
  if (!price) unavailable()
  return price.amount.minor / 10 ** price.amount.exponent
}
const monthlyAndYearly = (prices: Price[]) => ({ monthly: unitPrice(prices, 'month'), annual: unitPrice(prices, 'year') })

/**
 * The currently published offer as the marketing site reads it. It is built from the same published plan and bundles the
 * sign-up offers (so a price the visitor sees is the price sign-up will start from) plus the vendor's billing settings;
 * nothing here is typed in by hand except the names of the free base apps.
 */
export async function loadPublicPricing(client: Pick<PoolClient, 'query'>, planId: string): Promise<PublicPricing> {
  const { offer, bundles, plan, release } = await loadSignupOffer(client, planId)
  const settings = await billingSettings(client)
  const gb = (mb: number) => mb / MB_PER_GB
  const perGb = unitPrice(plan.storage_prices, 'month')
  const blockGb = gb(plan.storage_step_mb)
  if (settings.onboarding_currency !== 'SAR') unavailable()
  return publicPricingSchema.parse({
    schema_version: 1, currency: 'SAR', tax: 'none',
    free: { users: plan.included_users, storage_gb: gb(plan.included_storage_mb), branches: plan.included_extra_branches, apps: FREE_BASE_APPS },
    apps: offer.apps.map((app, index) => {
      const application = release.applications.find(candidate => candidate.id === app.id)
      if (!application) unavailable()
      return { key: app.id, name_ar: application.name_ar, name_en: application.name_en, ...monthlyAndYearly(bundles[index]!.prices) }
    }),
    extra_user: { ...monthlyAndYearly(plan.user_prices), max_users: MAX_USERS },
    extra_storage: {
      per_gb_monthly: perGb, block_gb: blockGb, block_monthly: perGb * blockGb,
      step_gb: blockGb, step_gb_after: gb(plan.storage_step_threshold_mb), step_gb_large: gb(plan.storage_large_step_mb),
    },
    onboarding: { one_time: settings.onboarding_fee_minor / 10 ** settings.onboarding_exponent },
    refund_days: settings.refund_window_days,
  })
}
