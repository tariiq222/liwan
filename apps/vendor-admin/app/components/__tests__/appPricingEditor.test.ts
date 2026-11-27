import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import type { CatalogRelease } from '@liwan/commercial-contracts'
import {
  actionBlockedReason, bundleDraftFromView, bundleLimitKeys, commercialErrorKey, commercialFailure,
  fieldIssue, isEditable, keyLabel, limitFromDraft, MAX_LIMIT, priceRowErrors, sar, type BundleView, type LifecycleAction,
} from '../../utils/vendorCommercial'
import { publishAddonPricing } from '../../utils/vendorAppPricing'
import { STEP_UP_CANCELLED_KEY, StepUpCancelled } from '../../composables/useStepUp'
import { loadSfc } from './sfc'

const rid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const release: CatalogRelease = {
  id: rid(1),
  version: '2026.11',
  source_digest: 'a'.repeat(64),
  artifact_digest: 'b'.repeat(64),
  applications: [
    { id: 'core', name_ar: 'الأساس', name_en: 'Core', modules: [], requires_apps: [], conflicts_with_apps: [], selectable: false, features: [] },
    {
      id: 'projects',
      name_ar: 'المشاريع',
      name_en: 'Projects',
      modules: ['liwan_pmo'],
      requires_apps: [],
      conflicts_with_apps: [],
      selectable: true,
      features: [
        { key: 'projects.enabled', kind: 'boolean', selectable: true, requires: [], enforcement_refs: [] },
        { key: 'projects.max_projects', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] },
      ],
    },
  ],
}

function makeBundle(overrides: Partial<BundleView> = {}): BundleView {
  return {
    id: rid(10),
    bundle_id: 'addon-projects',
    version: 1,
    edit_revision: 1,
    name: 'Projects add-on',
    description: 'Projects application add-on',
    status: 'published',
    available: true,
    audience: { kind: 'public' },
    catalog_release_id: release.id,
    selections: [{ app_id: 'projects', feature_keys: ['projects.enabled'] }],
    domain_limits: { 'projects.max_projects': 50 },
    prices: [{ cadence: { unit: 'month', count: 1 }, amount: sar(10000) }],
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    content_digest: 'c'.repeat(64),
    validated_digest: 'c'.repeat(64),
    ...overrides,
  } as BundleView
}

type MountOptions = {
  addon?: BundleView
  releases?: CatalogRelease[]
  capabilities?: string[]
  hydrated?: boolean
  act?: (kind: 'bundle', id: string, action: LifecycleAction, rev: number, reason: string) => Promise<unknown>
  update?: (kind: 'bundle', id: string, body: unknown) => Promise<unknown>
}

let env = {
  act: vi.fn<(kind: 'bundle', id: string, action: LifecycleAction, rev: number, reason: string) => Promise<unknown>>(),
  update: vi.fn<(kind: 'bundle', id: string, body: unknown) => Promise<unknown>>(),
  caps: ['vendor.catalog.manage', 'vendor.pricing.manage'] as string[],
  hydrated: Vue.ref(true),
}

const sfc = loadSfc('components/vendor/AppPricingEditor.vue', {
  useI18n: () => ({ t: (key: string) => key, te: () => true }),
  useHydrated: () => env.hydrated,
  useVendorContext: () => ({ can: (capability: string) => env.caps.includes(capability) }),
  useVendorCommercial: () => ({ act: (...args: Parameters<typeof env.act>) => env.act(...args), update: (...args: Parameters<typeof env.update>) => env.update(...args) }),
  actionBlockedReason,
  bundleDraftFromView,
  bundleLimitKeys,
  commercialErrorKey,
  commercialFailure,
  fieldIssue,
  isEditable,
  keyLabel,
  limitFromDraft,
  priceRowErrors,
  publishAddonPricing,
})

function mountEditor(options: MountOptions = {}) {
  const act = vi.fn(options.act ?? (async () => makeBundle()))
  const update = vi.fn(options.update ?? (async () => makeBundle({ status: 'draft', available: false })))
  const emit = vi.fn()
  env = {
    act,
    update,
    caps: options.capabilities ?? ['vendor.catalog.manage', 'vendor.pricing.manage'],
    hydrated: Vue.ref(options.hydrated ?? true),
  }
  const mounted = sfc.mount({ addon: options.addon ?? makeBundle(), releases: options.releases ?? [release] }, emit)
  return { ...mounted, act, update, emit }
}

const guardOf = (captured: { name: string; attrs: Record<string, unknown> }[]) =>
  captured.find(entry => entry.name === 'SharedUnsavedChanges')?.attrs

const submitOf = (captured: { name: string; attrs: Record<string, unknown> }[]) =>
  captured.find(entry => entry.name === 'UButton' && entry.attrs['data-testid'] === 'catalog-app-pricing-submit')?.attrs

/** A published add-on and the four revisions one save steps through. */
function revisionPath(n: number) {
  const published = makeBundle({ id: rid(n), edit_revision: 1, status: 'published', available: true })
  const newDraft = makeBundle({ id: rid(n + 1), version: 2, edit_revision: 1, status: 'draft', available: false })
  const updatedDraft = { ...newDraft, edit_revision: 2, prices: [{ cadence: { unit: 'month' as const, count: 1 }, amount: sar(15000) }] }
  const validated = { ...updatedDraft, edit_revision: 3, status: 'validated' as const }
  return { published, newDraft, updatedDraft, validated, finalPublished: { ...validated, edit_revision: 4, status: 'published' as const, available: true } }
}

describe('AppPricingEditor', () => {
  it('makes zero network calls when price, limit (> MAX_LIMIT or empty), or reason (< 3 chars) is invalid', async () => {
    const { state, act, update, render } = mountEditor()

    // Short reason (< 3 chars)
    state.draft.reason = 'ab'
    await state.submit()
    expect(act).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    // Limit above MAX_LIMIT
    state.draft.reason = 'Valid pricing update'
    state.draft.limits['projects.max_projects'] = { mode: 'number', value: String(MAX_LIMIT + 1) }
    await state.submit()
    expect(act).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    // Empty limit choice
    state.draft.limits['projects.max_projects'] = { mode: '', value: '' }
    await state.submit()
    expect(act).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    // Invalid price amount
    state.draft.limits['projects.max_projects'] = { mode: 'number', value: '100' }
    state.draft.prices = [{ unit: 'month', count: '1', amount: 'not-a-number' }]
    await state.submit()
    expect(act).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()

    const { html } = await render()
    expect(html).toContain('vendor.pricing.prices.invalid')
  })

  it('tracks SharedUnsavedChanges dirty state on edits and resets after save and after reload', async () => {
    const published = makeBundle({ id: rid(10), edit_revision: 1, status: 'published', available: true })
    const newDraft = makeBundle({ id: rid(11), version: 2, edit_revision: 1, status: 'draft', available: false })
    const updatedDraft = { ...newDraft, edit_revision: 2, prices: [{ cadence: { unit: 'month' as const, count: 1 }, amount: sar(12500) }] }
    const validated = { ...updatedDraft, edit_revision: 3, status: 'validated' as const }
    const finalPublished = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    const { state, render, emit } = mountEditor({
      addon: published,
      act: async (_k, _id, action) => (action === 'revisions' ? newDraft : action === 'validate' ? validated : finalPublished),
      update: async () => updatedDraft,
    })

    expect(guardOf((await render()).captured)?.dirty).toBe(false)

    // Edit price -> dirty becomes true; reload resets dirty to false
    state.draft.prices = [{ unit: 'month', count: '1', amount: '125.00' }]
    expect(guardOf((await render()).captured)?.dirty).toBe(true)

    state.reload()
    expect(emit).toHaveBeenCalledWith('reload')
    expect(guardOf((await render()).captured)?.dirty).toBe(false)

    // Edit and save -> dirty resets to false on success and emits done
    state.draft.prices = [{ unit: 'month', count: '1', amount: '125.00' }]
    state.draft.reason = 'Quarterly price adjustment'
    expect(guardOf((await render()).captured)?.dirty).toBe(true)

    await state.submit()
    expect(emit).toHaveBeenCalledWith('done', finalPublished)
    expect(guardOf((await render()).captured)?.dirty).toBe(false)
  })

  it('shows a failed publish, keeps the working draft and retries without a second revision', async () => {
    const { published, newDraft, updatedDraft, validated, finalPublished } = revisionPath(20)
    const actions: string[] = []
    let publishAttempts = 0
    const { state, emit, render } = mountEditor({
      addon: published,
      // The first publish stops when the passkey prompt is closed; the retry's goes through.
      act: async (_k, id, action) => {
        actions.push(`${action}:${id}`)
        if (action === 'revisions') return newDraft
        if (action === 'validate') return validated
        if (action === 'publish' && ++publishAttempts === 1) throw new StepUpCancelled()
        return finalPublished
      },
      update: async (_k, id) => {
        actions.push(`update:${id}`)
        return updatedDraft
      },
    })

    state.draft.prices = [{ unit: 'month', count: '1', amount: '150.00' }]
    state.draft.reason = 'Update price for Q4'
    await state.submit()

    // The refusal is on the form, and the revision it reached is kept for the retry.
    expect(actions).toEqual([`revisions:${rid(20)}`, `update:${rid(21)}`, `validate:${rid(21)}`, `publish:${rid(21)}`])
    expect(state.failure.value).toBeInstanceOf(StepUpCancelled)
    expect((await render()).html).toContain(STEP_UP_CANCELLED_KEY)
    expect(state.workingDraft.value).toEqual(validated)
    expect(emit).toHaveBeenCalledWith('busy', true)
    expect(emit).toHaveBeenCalledWith('busy', false)
    expect(emit).toHaveBeenCalledWith('working-draft', newDraft)
    expect(emit).toHaveBeenCalledWith('working-draft', validated)
    expect(emit).not.toHaveBeenCalledWith('done', expect.anything())

    // The retry publishes the kept revision: no second revisions, update or validate, and the refusal is gone.
    actions.length = 0
    await state.submit()
    expect(actions).toEqual([`publish:${rid(21)}`])
    expect(emit).toHaveBeenCalledWith('done', finalPublished)
    expect(state.failure.value).toBeNull()
    expect((await render()).html).not.toContain(STEP_UP_CANCELLED_KEY)
  })

  it('reports the created revision when cancelled after a failed publish, and none when nothing was sent', async () => {
    const { published, newDraft, updatedDraft, validated } = revisionPath(30)
    const cancelled = mountEditor({
      addon: published,
      act: async (_k, _id, action) => {
        if (action === 'revisions') return newDraft
        if (action === 'validate') return validated
        throw new StepUpCancelled()
      },
      update: async () => updatedDraft,
    })
    cancelled.state.draft.prices = [{ unit: 'month', count: '1', amount: '150.00' }]
    cancelled.state.draft.reason = 'Cancelled attempt'
    await cancelled.state.submit()
    expect(cancelled.state.failure.value).toBeInstanceOf(StepUpCancelled)
    expect(cancelled.state.workingDraft.value).toEqual(validated)
    cancelled.state.cancel()
    expect(cancelled.emit).toHaveBeenCalledWith('cancel', true)
    expect(cancelled.emit).toHaveBeenCalledWith('working-draft', null)

    const untouched = mountEditor({ addon: published })
    untouched.state.cancel()
    expect(untouched.emit).toHaveBeenCalledWith('cancel', false)
    expect(untouched.emit).toHaveBeenCalledWith('working-draft', null)
  })

  it('shows blocked alert and disables submit when user lacks vendor.pricing.manage', async () => {
    const { state, act, update, render } = mountEditor({ capabilities: ['vendor.catalog.manage'] })
    const { captured, html } = await render()

    expect(html).toContain('vendor.pricing.blocked.pricing')
    expect(submitOf(captured)?.disabled).toBe(true)

    state.draft.reason = 'Attempt without pricing capability'
    await state.submit()
    expect(act).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
})
