import type { Pool } from 'pg'
import { createBundle, mutateBundle } from './bundles.js'
import { getRelease } from './catalog-releases.js'
import { mutatePlan } from './plans.js'
import { CommercialHttpError, type CommercialActor } from './lifecycle.js'

/** The seeded LiwanOS plan family (schema_025.sql): the one sellable platform plan whose applications are optional bundles. */
const LIWAN_PLAN_ID = '00000000-0000-4000-8000-0000000000b1'
// PLACEHOLDER prices, the same development amounts schema_025 seeds; the owner replaces them from the vendor console.
const PLACEHOLDER_PRICES = [
  { cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 19900 } },
  { cadence: { unit: 'year', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 199000 } },
]
const PLAN_FIELDS = ['name', 'audience', 'term_months', 'currency', 'prices', 'platform_limits', 'included_bundle_revision_ids', 'optional_bundle_revision_ids',
  'included_extra_branches', 'extra_branch_prices', 'extra_branches_limit', 'included_users', 'included_storage_mb', 'user_prices', 'storage_prices',
  'policy_revision_id', 'trial_days', 'grace_days', 'auto_suspend', 'auto_renew_allowed'] as const

/**
 * Publishes one default bundle per selectable application of a catalog release, then a new revision of the LiwanOS
 * plan that lists them as optional. Idempotent: an application that already has a published, available bundle in
 * the release is reused, and the plan only gets a new revision when it is missing one of them.
 */
export async function seedDefaultBundles(pool: Pool, actor: CommercialActor, input: { release_id: string; reason: string }) {
  const { release_id, reason } = input
  const release = await getRelease(pool, release_id)
  const existing = (await pool.query("SELECT id,selections FROM bundle_revisions WHERE catalog_release_id=$1 AND status='published' AND available", [release_id])).rows
  const bundleIds: string[] = []
  const created: string[] = []
  for (const app of release.applications.filter(a => a.selectable)) {
    const reused = existing.find(b => b.selections.length === 1 && b.selections[0].app_id === app.id)
    if (reused) { bundleIds.push(reused.id); continue }
    const featureKeys = app.features.filter(f => f.kind === 'boolean' && f.selectable).map(f => f.key)
    const draft = await createBundle(pool, actor, {
      name: app.name_ar, description: app.name_en, audience: { kind: 'public' }, catalog_release_id: release_id,
      selections: [{ app_id: app.id, feature_keys: featureKeys }], domain_limits: {}, prices: PLACEHOLDER_PRICES, reason,
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
  body.optional_bundle_revision_ids = [...new Set([...(draft.optional_bundle_revision_ids as string[]), ...bundleIds])]
  const edited = await mutatePlan(pool, actor, draft.id, 'edit', { ...body, edit_revision: draft.edit_revision, reason }) as unknown as { edit_revision: number }
  const validated = await mutatePlan(pool, actor, draft.id, 'validate', { edit_revision: edited.edit_revision, reason }) as unknown as { edit_revision: number }
  await mutatePlan(pool, actor, draft.id, 'publish', { edit_revision: validated.edit_revision, reason })
  return { bundles: bundleIds, created, plan_revision_id: draft.id, plan_created: true }
}
