import type { PoolClient } from 'pg'
import { signupAppSchema, signupOfferSchema } from '@liwan/commercial-contracts'
import { compileEntitlements } from '@liwan/commercial-contracts/server'
import { bundleRevision, loadRelease } from '../commercial/bundles.js'
import { planRevision } from '../commercial/plans.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'

export const signupCadence = { unit: 'month', count: 1 } as const
const monthly = (price: { cadence: { unit: string; count: number }; amount: { currency: string; exponent: number } }) =>
  price.cadence.unit === signupCadence.unit && price.cadence.count === signupCadence.count &&
  price.amount.currency === 'SAR' && price.amount.exponent === 2

function unavailable(): never { throw new CommercialHttpError('unavailable', 503) }

/** The offer of a plan: its latest published, available revision, so publishing a new revision keeps sign-up and pricing open. */
export async function loadSignupOffer(client: Pick<PoolClient, 'query'>, planId: string) {
  const row = (await client.query(`SELECT r.* FROM plan_revisions r
    JOIN pricing_policy_revisions p ON p.id=r.policy_revision_id AND p.status='approved' AND p.tax_kind='none'
    WHERE r.plan_id=$1 AND r.status='published' AND r.available AND r.audience->>'kind'='public'
      AND r.trial_days=14 ORDER BY r.version DESC LIMIT 1 FOR SHARE OF r`, [planId])).rows[0]
  if (!row) unavailable()
  const plan = planRevision(row)
  if (plan.prices.find(monthly)?.amount.minor !== 0 || plan.included_bundle_revision_ids.length) unavailable()

  const candidates = (await client.query(`SELECT * FROM bundle_revisions
    WHERE id=ANY($1::uuid[]) AND status='published' AND available AND audience->>'kind'='public'
    FOR SHARE`, [plan.optional_bundle_revision_ids])).rows.map(bundleRevision)
  const bundles = signupAppSchema.options.map(id => {
    const matches = candidates.filter(bundle => bundle.selections.length === 1 && bundle.selections[0]?.app_id === id)
    if (matches.length !== 1) unavailable()
    return matches[0]!
  })
  const release = await loadRelease(client, bundles[0]!.catalog_release_id)
  const quantities = { users: plan.included_users, storage_mb: plan.included_storage_mb }
  const apps = bundles.map((bundle, index) => {
    const id = signupAppSchema.options[index]!
    const amount = bundle.prices.find(monthly)?.amount
    if (!amount?.minor) unavailable()
    const { features } = compileEntitlements({ release, plan, bundles: [bundle], terms: null, quantities })
    if (features[id + '.enabled'] !== true) unavailable()
    const limits: Record<string, number | null> = {}
    for (const [key, value] of Object.entries(features)) {
      if (key.startsWith(id + '.') && (value === null || typeof value === 'number')) limits[key] = value
    }
    return { id, monthly_minor: amount.minor, limits }
  })
  compileEntitlements({ release, plan, bundles, terms: null, quantities })
  const offer = signupOfferSchema.parse({
    offer_revision: plan.id, trial_days: plan.trial_days, currency: 'SAR',
    included_users: plan.included_users, included_storage_mb: plan.included_storage_mb,
    included_extra_branches: plan.included_extra_branches, apps,
  })
  return { offer, bundles, plan, release }
}
