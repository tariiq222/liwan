import { describe, expect, it, vi } from 'vitest'
import type { CatalogRelease } from '@liwan/commercial-contracts'
import { StepUpCancelled } from '../../composables/useStepUp'
import { bundleDraftFromView, LimitAboveMax, MAX_LIMIT, sar, type BundleDraft, type BundleView, type LifecycleAction } from '../vendorCommercial'
import { publishAddonPricing, type AddonPricingApi } from '../vendorAppPricing'

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
        { key: 'users.limit', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] },
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

function editedDraft(base: BundleView, patch: Partial<BundleDraft> = {}): BundleDraft {
  return {
    ...bundleDraftFromView(base),
    prices: [{ unit: 'month', count: '1', amount: '150.00' }],
    limits: { 'projects.max_projects': { mode: 'number', value: '100' } },
    ...patch,
  }
}

describe('publishAddonPricing', () => {
  it('runs revisions -> update -> validate -> publish for a published add-on', async () => {
    const published = makeBundle({ id: rid(10), version: 1, edit_revision: 2, status: 'published', available: true })
    const newDraft = makeBundle({ id: rid(11), version: 2, edit_revision: 1, status: 'draft', available: false })
    const updatedDraft = makeBundle({
      id: rid(11), version: 2, edit_revision: 2, status: 'draft', available: false,
      prices: [{ cadence: { unit: 'month', count: 1 }, amount: sar(15000) }],
      domain_limits: { 'projects.max_projects': 100 },
    })
    const validated = { ...updatedDraft, edit_revision: 3, status: 'validated' as const }
    const finalPublished = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    const calls: string[] = []
    const workingHistory: BundleView[] = []
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action: LifecycleAction, editRevision, reason) => {
        calls.push(`${action}:${id}:r${editRevision}:${reason}`)
        if (action === 'revisions') return newDraft as never
        if (action === 'validate') return validated as never
        if (action === 'publish') return finalPublished as never
        throw new Error(`unexpected action ${action}`)
      }),
      update: vi.fn(async (_kind, id, body: unknown) => {
        const payload = body as { edit_revision: number; reason: string; prices: unknown[]; domain_limits: Record<string, number | null> }
        calls.push(`update:${id}:r${payload.edit_revision}:${payload.reason}`)
        expect(payload.prices).toEqual([{ cadence: { unit: 'month', count: 1 }, amount: sar(15000) }])
        expect(payload.domain_limits).toEqual({ 'projects.max_projects': 100 })
        return updatedDraft as never
      }),
    }

    const result = await publishAddonPricing({
      api,
      current: published,
      nextDraft: editedDraft(published),
      release,
      reason: '  Annual price revision  ',
      onWorkingDraft: draft => workingHistory.push(draft),
    })

    expect(result).toBe(finalPublished)
    expect(calls).toEqual([
      `revisions:${rid(10)}:r2:Annual price revision`,
      `update:${rid(11)}:r1:Annual price revision`,
      `validate:${rid(11)}:r2:Annual price revision`,
      `publish:${rid(11)}:r3:Annual price revision`,
    ])
    expect(workingHistory).toEqual([newDraft, updatedDraft, validated])
  })

  it('runs update -> validate -> publish without revisions for a draft add-on', async () => {
    const draft = makeBundle({ id: rid(20), version: 1, edit_revision: 1, status: 'draft', available: false })
    const updated = { ...draft, edit_revision: 2, prices: [{ cadence: { unit: 'month' as const, count: 1 }, amount: sar(15000) }] }
    const validated = { ...updated, edit_revision: 3, status: 'validated' as const }
    const published = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    const calls: string[] = []
    const workingHistory: BundleView[] = []
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action, rev) => {
        calls.push(`${action}:${id}:r${rev}`)
        return (action === 'validate' ? validated : published) as never
      }),
      update: vi.fn(async (_kind, id, body: unknown) => {
        calls.push(`update:${id}:r${(body as { edit_revision: number }).edit_revision}`)
        return updated as never
      }),
    }

    const result = await publishAddonPricing({
      api,
      current: draft,
      nextDraft: editedDraft(draft),
      release,
      reason: 'Ready for sale',
      onWorkingDraft: next => workingHistory.push(next),
    })

    expect(result).toBe(published)
    expect(calls).toEqual([
      `update:${rid(20)}:r1`,
      `validate:${rid(20)}:r2`,
      `publish:${rid(20)}:r3`,
    ])
    expect(workingHistory).toEqual([updated, validated])
  })

  it('runs update -> validate -> publish for a validated add-on when prices or limits changed', async () => {
    const validated = makeBundle({ id: rid(30), version: 1, edit_revision: 3, status: 'validated', available: false })
    const returnedToDraft = { ...validated, edit_revision: 4, status: 'draft' as const, domain_limits: { 'projects.max_projects': null } }
    const revalidated = { ...returnedToDraft, edit_revision: 5, status: 'validated' as const }
    const published = { ...revalidated, edit_revision: 6, status: 'published' as const, available: true }

    const calls: string[] = []
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action, rev) => {
        calls.push(`${action}:${id}:r${rev}`)
        return (action === 'validate' ? revalidated : published) as never
      }),
      update: vi.fn(async (_kind, id, body: unknown) => {
        const payload = body as { edit_revision: number; domain_limits: Record<string, number | null> }
        calls.push(`update:${id}:r${payload.edit_revision}`)
        expect(payload.domain_limits).toEqual({ 'projects.max_projects': null })
        return returnedToDraft as never
      }),
    }

    const nextDraft: BundleDraft = {
      ...bundleDraftFromView(validated),
      limits: { 'projects.max_projects': { mode: 'unlimited', value: '' } },
    }
    const result = await publishAddonPricing({ api, current: validated, nextDraft, release, reason: 'Remove project cap' })

    expect(result).toBe(published)
    expect(calls).toEqual([
      `update:${rid(30)}:r3`,
      `validate:${rid(30)}:r4`,
      `publish:${rid(30)}:r5`,
    ])
  })

  it('calls publish only for a validated add-on when neither prices nor limits changed', async () => {
    const validated = makeBundle({ id: rid(31), version: 1, edit_revision: 3, status: 'validated', available: false })
    const published = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    const calls: string[] = []
    const onWorkingDraft = vi.fn()
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action, rev, reason) => {
        calls.push(`${action}:${id}:r${rev}:${reason}`)
        return published as never
      }),
      update: vi.fn(async () => { throw new Error('update should not be called') }),
    }

    const result = await publishAddonPricing({
      api,
      current: validated,
      nextDraft: bundleDraftFromView(validated),
      release,
      reason: 'Approve validated add-on',
      onWorkingDraft,
    })

    expect(result).toBe(published)
    expect(calls).toEqual([`publish:${rid(31)}:r3:Approve validated add-on`])
    expect(api.update).not.toHaveBeenCalled()
    expect(onWorkingDraft).not.toHaveBeenCalled()
  })

  it('resumes from captured workingDraft after partial failure or StepUpCancelled without calling revisions again', async () => {
    const published = makeBundle({ id: rid(40), version: 1, edit_revision: 2, status: 'published', available: true })
    const newDraft = makeBundle({ id: rid(41), version: 2, edit_revision: 1, status: 'draft', available: false })
    const updatedDraft = makeBundle({
      id: rid(41), version: 2, edit_revision: 2, status: 'draft', available: false,
      prices: [{ cadence: { unit: 'month', count: 1 }, amount: sar(15000) }],
      domain_limits: { 'projects.max_projects': 100 },
    })
    const validated = { ...updatedDraft, edit_revision: 3, status: 'validated' as const }
    const finalPublished = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    let workingDraft: BundleView | null = null
    let failPublishOnce = true
    const calls: string[] = []
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action, rev) => {
        calls.push(`${action}:${id}:r${rev}`)
        if (action === 'revisions') return newDraft as never
        if (action === 'validate') return validated as never
        if (action === 'publish') {
          if (failPublishOnce) {
            failPublishOnce = false
            throw new StepUpCancelled()
          }
          return finalPublished as never
        }
        throw new Error(`unexpected ${action}`)
      }),
      update: vi.fn(async (_kind, id, body: unknown) => {
        calls.push(`update:${id}:r${(body as { edit_revision: number }).edit_revision}`)
        return updatedDraft as never
      }),
    }

    const nextDraft = editedDraft(published)
    await expect(publishAddonPricing({
      api,
      current: published,
      nextDraft,
      release,
      reason: 'Retry test',
      onWorkingDraft: next => { workingDraft = next },
    })).rejects.toBeInstanceOf(StepUpCancelled)

    expect(workingDraft).toBe(validated)

    // Retry from the captured validated workingDraft: neither revisions, update nor validate runs again.
    calls.length = 0
    const retryResult = await publishAddonPricing({
      api,
      current: workingDraft!,
      nextDraft,
      release,
      reason: 'Retry test',
      onWorkingDraft: next => { workingDraft = next },
    })

    expect(retryResult).toBe(finalPublished)
    expect(calls).toEqual([`publish:${rid(41)}:r3`])
  })

  it('resumes from captured draft if update fails right after revisions', async () => {
    const published = makeBundle({ id: rid(50), version: 1, edit_revision: 1, status: 'published', available: true })
    const newDraft = makeBundle({ id: rid(51), version: 2, edit_revision: 1, status: 'draft', available: false })
    const updatedDraft = { ...newDraft, edit_revision: 2, prices: [{ cadence: { unit: 'month' as const, count: 1 }, amount: sar(15000) }], domain_limits: { 'projects.max_projects': 100 } }
    const validated = { ...updatedDraft, edit_revision: 3, status: 'validated' as const }
    const finalPublished = { ...validated, edit_revision: 4, status: 'published' as const, available: true }

    let workingDraft: BundleView | null = null
    let failUpdateOnce = true
    const calls: string[] = []
    const api: AddonPricingApi = {
      act: vi.fn(async (_kind, id, action, rev) => {
        calls.push(`${action}:${id}:r${rev}`)
        if (action === 'revisions') return newDraft as never
        if (action === 'validate') return validated as never
        return finalPublished as never
      }),
      update: vi.fn(async (_kind, id, body: unknown) => {
        calls.push(`update:${id}:r${(body as { edit_revision: number }).edit_revision}`)
        if (failUpdateOnce) {
          failUpdateOnce = false
          throw new Error('temporary_failure')
        }
        return updatedDraft as never
      }),
    }

    const nextDraft = editedDraft(published)
    await expect(publishAddonPricing({
      api,
      current: published,
      nextDraft,
      release,
      reason: 'Update retry',
      onWorkingDraft: next => { workingDraft = next },
    })).rejects.toThrow('temporary_failure')

    expect(workingDraft).toBe(newDraft)

    calls.length = 0
    const retryResult = await publishAddonPricing({
      api,
      current: workingDraft!,
      nextDraft,
      release,
      reason: 'Update retry',
      onWorkingDraft: next => { workingDraft = next },
    })

    expect(retryResult).toBe(finalPublished)
    expect(calls).toEqual([
      `update:${rid(51)}:r1`,
      `validate:${rid(51)}:r2`,
      `publish:${rid(51)}:r3`,
    ])
  })

  it('rejects malformed payloads (out-of-range limit or short reason) before calling POST /revisions', async () => {
    const published = makeBundle({ id: rid(60), version: 1, edit_revision: 1, status: 'published', available: true })
    const api: AddonPricingApi = {
      act: vi.fn(async () => { throw new Error('act should not be called') }),
      update: vi.fn(async () => { throw new Error('update should not be called') }),
    }
    const onWorkingDraft = vi.fn()

    // A whole number above the maximum is refused on its own, before anything is sent.
    const outOfRange = editedDraft(published, { limits: { 'projects.max_projects': { mode: 'number', value: String(MAX_LIMIT + 1) } } })
    await expect(publishAddonPricing({ api, current: published, nextDraft: outOfRange, release, reason: 'Valid reason', onWorkingDraft })).rejects.toThrow(LimitAboveMax)
    await expect(publishAddonPricing({ api, current: published, nextDraft: editedDraft(published), release, reason: 'no', onWorkingDraft })).rejects.toThrow()

    expect(api.act).not.toHaveBeenCalled()
    expect(api.update).not.toHaveBeenCalled()
    expect(onWorkingDraft).not.toHaveBeenCalled()
  })
})
