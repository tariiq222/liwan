import type { Pool } from 'pg'
import { isSellable } from '@liwan/commercial-contracts/server'
import { createBundle, DERIVED_LIMITS, mutateBundle } from './bundles.js'
import { getRelease } from './catalog-releases.js'
import { mutatePlan } from './plans.js'
import { CommercialHttpError, type CommercialActor } from './lifecycle.js'

/** The seeded LiwanOS plan family (schema_025.sql): the one sellable platform plan whose applications are optional bundles. */
const LIWAN_PLAN_ID = '00000000-0000-4000-8000-0000000000b1'
/** Release 1 application prices per month in SAR minor units (owner decision 2026-11-06). Seed amounts only: the
 *  vendor console owns every later change, and the annual price is exactly ten monthly payments. */
const SEED_MONTHLY_MINOR: Record<string, number> = { crm: 9900, inbox: 25000 }
const DEFAULT_SEED_MONTHLY_MINOR = 0
/** Annual is ten months for twelve: the one ratio every seeded amount follows. */
const ANNUAL_MONTHS = 10
function seedPrices(appId: string) {
  const minor = SEED_MONTHLY_MINOR[appId] ?? DEFAULT_SEED_MONTHLY_MINOR
  return [
    { cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor } },
    { cadence: { unit: 'year', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: minor * ANNUAL_MONTHS } },
  ]
}
const PLAN_FIELDS = ['name', 'audience', 'term_months', 'currency', 'prices', 'platform_limits', 'included_bundle_revision_ids', 'optional_bundle_revision_ids',
  'included_extra_branches', 'extra_branch_prices', 'extra_branches_limit', 'included_users', 'included_storage_mb',
  'storage_step_mb', 'storage_step_threshold_mb', 'storage_large_step_mb', 'user_prices', 'storage_prices',
  'policy_revision_id', 'trial_days', 'grace_days', 'auto_suspend', 'auto_renew_allowed'] as const

/**
 * Publishes one default bundle per sellable application of a catalog release, then a new revision of the LiwanOS
 * plan that lists them as optional. Idempotent: an application that already has a published, available bundle in
 * the release is reused, and the plan only gets a new revision when it is missing one of them.
 */
export async function seedDefaultBundles(pool: Pool, actor: CommercialActor, input: { release_id: string; reason: string }) {
  const { release_id, reason } = input
  const release = await getRelease(pool, release_id)
  const existing = (await pool.query("SELECT id,selections FROM bundle_revisions WHERE catalog_release_id=$1 AND status='published' AND available", [release_id])).rows
  const bundleIds: string[] = []
  const created: string[] = []
  for (const app of release.applications.filter(isSellable)) {
    const reused = existing.find(b => b.selections.length === 1 && b.selections[0].app_id === app.id)
    if (reused) { bundleIds.push(reused.id); continue }
    const featureKeys = app.features.filter(f => f.kind === 'boolean' && f.selectable).map(f => f.key)
    const draft = await createBundle(pool, actor, {
      name: app.name_ar, description: app.name_en, audience: { kind: 'public' }, catalog_release_id: release_id,
      selections: [{ app_id: app.id, feature_keys: featureKeys }], domain_limits: {}, prices: seedPrices(app.id), reason,
    })
    const validated = await mutateBundle(pool, actor, draft.id, 'validate', { edit_revision: draft.edit_revision, reason }, { pricingGranted: true, pricingStepUp: true })
    await mutateBundle(pool, actor, draft.id, 'publish', { edit_revision: (validated as { edit_revision: number }).edit_revision, reason }, { pricingGranted: true, pricingStepUp: true })
    bundleIds.push(draft.id); created.push(draft.id)
  }
  const current = (await pool.query("SELECT id,optional_bundle_revision_ids,edit_revision FROM plan_revisions WHERE plan_id=$1 AND status='published' AND available ORDER BY version DESC LIMIT 1", [LIWAN_PLAN_ID])).rows[0]
  if (!current) throw new CommercialHttpError('seed_plan_missing', 409)
  const listed = new Set<string>(current.optional_bundle_revision_ids)
  if (bundleIds.every(id => listed.has(id))) return { bundles: bundleIds, created, plan_revision_id: current.id as string, plan_created: false }
  const draft = await mutatePlan(pool, actor, current.id, 'revisions', { edit_revision: current.edit_revision, reason }) as unknown as Record<string, unknown> & { id: string; edit_revision: number }
  const body = Object.fromEntries(PLAN_FIELDS.map(k => [k, draft[k]]))
  // A plan revision compiles against one catalog release, so it lists only this release's bundles (validation refuses a mix).
  body.optional_bundle_revision_ids = bundleIds
  // The new revision is a clone of the previous one, which may carry limits this release no longer declares (a renamed one):
  // compiling refuses those (limit_not_supported), so only the keys the release declares are kept. A limit the release adds
  // A limit the release adds is seeded with the catalog's own ceiling for it (the free assistants' budget, 100 a month,
  // which is also what the seeded LiwanOS plan carries) and otherwise as null (unlimited fair use, owner decision
  // 2026-10-25), for the owner to tighten in the vendor console.
  const declared = new Map(release.applications.filter(a => !a.selectable).flatMap(a => a.features.filter(f => f.kind === 'limit' && !DERIVED_LIMITS.includes(f.key)).map(f => [f.key, f] as const)))
  const platformLimits: Record<string, number | null> = {}
  for (const [key, feature] of declared) {
    const kept = draft.platform_limits as Record<string, number | null>
    platformLimits[key] = Object.hasOwn(kept, key) ? kept[key]! : (feature.ceiling ?? null)
  }
  body.platform_limits = platformLimits
  const edited = await mutatePlan(pool, actor, draft.id, 'edit', { ...body, edit_revision: draft.edit_revision, reason }) as unknown as { edit_revision: number }
  const validated = await mutatePlan(pool, actor, draft.id, 'validate', { edit_revision: edited.edit_revision, reason }) as unknown as { edit_revision: number }
  await mutatePlan(pool, actor, draft.id, 'publish', { edit_revision: validated.edit_revision, reason })
  return { bundles: bundleIds, created, plan_revision_id: draft.id, plan_created: true }
}
