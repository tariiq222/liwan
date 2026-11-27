import type { CapacityMap, CatalogRelease, Price } from '@liwan/commercial-contracts'
import { bundleEditPayload, bundleFields, isEditable, type BundleDraft, type BundleView, type LifecycleAction } from './vendorCommercial'

export type AddonPricingApi = {
  update: <T extends BundleView>(kind: 'bundle', id: string, body: unknown) => Promise<T>
  act: <T>(kind: 'bundle', id: string, action: LifecycleAction, editRevision: number, reason: string) => Promise<T>
}

export type PublishAddonPricingInput = {
  api: AddonPricingApi
  current: BundleView
  nextDraft: BundleDraft
  release: CatalogRelease
  reason: string
  onWorkingDraft?: (draft: BundleView) => void
}

function samePrices(a: Price[], b: Price[]): boolean {
  if (a.length !== b.length) return false
  return a.every((price, index) => {
    const other = b[index]!
    return price.cadence.unit === other.cadence.unit
      && price.cadence.count === other.cadence.count
      && price.amount.currency === other.amount.currency
      && price.amount.exponent === other.amount.exponent
      && price.amount.minor === other.amount.minor
  })
}

function sameLimits(a: CapacityMap, b: CapacityMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Object.hasOwn(a, key) !== Object.hasOwn(b, key) || a[key] !== b[key]) return false
  }
  return true
}

/** True when the draft's prices or domain limits differ from the add-on revision currently on the server. */
export function addonPricingChanged(current: BundleView, nextDraft: BundleDraft, release: CatalogRelease): boolean {
  const next = bundleFields(nextDraft, release)
  return !samePrices(current.prices, next.prices) || !sameLimits(current.domain_limits, next.domain_limits)
}

/**
 * Publishes price and limit updates for an application's add-on in one flow:
 * - Published (non-editable) add-on: creates a new draft revision first.
 * - Draft add-on, or validated add-on with edited prices/limits: saves the edit payload.
 * - Draft add-on: validates before publishing.
 * - Publishes the validated revision with the supplied reason.
 *
 * Reports each intermediate revision via `onWorkingDraft` so a retry after partial failure
 * (e.g. cancelled passkey step-up) resumes without creating duplicate revisions.
 */
export async function publishAddonPricing(input: PublishAddonPricingInput): Promise<BundleView> {
  const { api, nextDraft, release, onWorkingDraft } = input
  const reason = input.reason.trim()
  const draftWithReason: BundleDraft = { ...nextDraft, reason }
  // Validate the edit payload before any mutation so a malformed draft never creates an orphaned revision via POST /revisions.
  bundleEditPayload(draftWithReason, release, input.current.edit_revision)
  let working = input.current

  if (!isEditable(working)) {
    working = await api.act<BundleView>('bundle', working.id, 'revisions', working.edit_revision, reason)
    onWorkingDraft?.(working)
  }

  if (working.status === 'draft' || addonPricingChanged(working, draftWithReason, release)) {
    working = await api.update<BundleView>('bundle', working.id, bundleEditPayload(draftWithReason, release, working.edit_revision))
    onWorkingDraft?.(working)
  }

  if (working.status === 'draft') {
    working = await api.act<BundleView>('bundle', working.id, 'validate', working.edit_revision, reason)
    onWorkingDraft?.(working)
  }

  return api.act<BundleView>('bundle', working.id, 'publish', working.edit_revision, reason)
}
