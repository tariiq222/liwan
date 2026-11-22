import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { catalogActionErrorKey, nextCatalogAction, type CatalogVersion } from '../../utils/vendorCatalogVersions'
import { loadSfc } from './sfc'

const useI18n = () => ({ t: (key: string) => key })
const version = (status: CatalogVersion['status']): CatalogVersion => ({ id: 'c-1', version: '2026.11', status, created_at: '2026-11-01T08:00:00Z', solution: {} })

function panel(allowed = true) {
  const act = vi.fn().mockResolvedValue({})
  const sfc = loadSfc('components/vendor/CatalogVersionAction.vue', { useI18n, useHydrated: () => Vue.ref(true), useVendorContext: () => ({ can: () => allowed }), useVendorCatalogVersions: () => ({ act }), catalogActionErrorKey, nextCatalogAction })
  return { act, sfc }
}

describe('catalog version action', () => {
  it('validates a draft and publishes a validated version, with the reason trimmed', async () => {
    for (const [status, step] of [['draft', 'validate'], ['validated', 'publish']] as const) {
      const { act, sfc } = panel(); const emit = vi.fn()
      const setup = sfc.setup({ version: version(status) }, emit)
      expect(setup.action.value).toBe(step)
      setup.reason.value = '  Ready for sale  '
      await setup.perform()
      expect(act).toHaveBeenCalledWith('c-1', step, 'Ready for sale')
      expect(emit).toHaveBeenCalledWith('done')
    }
  })

  it('asks for a reason of 3 to 1000 characters before calling the control plane', async () => {
    const { act, sfc } = panel(); const emit = vi.fn()
    const setup = sfc.setup({ version: version('draft') }, emit)
    setup.reason.value = 'ab'
    await setup.perform()
    expect(act).not.toHaveBeenCalled(); expect(setup.reasonError.value).toBe('vendor.pricing.reasonRequired'); expect(emit).not.toHaveBeenCalled()
    setup.reason.value = 'x'.repeat(1001)
    expect(setup.reasonError.value).toBe('vendor.pricing.reasonRequired')
  })

  it('shows a refusal through the catalog error map and does not report done', async () => {
    const { act, sfc } = panel(); const emit = vi.fn()
    act.mockRejectedValueOnce({ data: { code: 'catalog_source_not_publishable' }, statusCode: 409 })
    const setup = sfc.setup({ version: version('validated') }, emit)
    setup.reason.value = 'Publish it'
    await setup.perform()
    expect(catalogActionErrorKey(setup.failure.value)).toBe('vendor.pricing.errors.catalog_source_not_publishable')
    expect(emit).not.toHaveBeenCalled()
  })

  it('renders nothing for a published version and no form without the catalog capability', async () => {
    const published = await panel().sfc.html({ version: version('published') })
    expect(published).not.toContain('catalog-action-form')
    const blocked = await panel(false).sfc.html({ version: version('draft') })
    expect(blocked).toContain('vendor.pricing.blocked.catalog'); expect(blocked).not.toContain('<form')
  })
})
