import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { loadSfc } from './sfc'
import { showsSharedBackups } from '../../utils/sharedBackups'
import { keyLabel } from '../../utils/vendorCommercial'

const tenantId = '10000000-0000-4000-8000-000000000001'
const tenant = (over: Record<string, unknown> = {}) => ({ id: tenantId, name: 'Acme', commercial_mode: 'saas', hosting_model: 'shared_managed', inventory_target: 'x', catalog_version: null, catalog_tier: null, status: 'active', desired_policy: null, observed_policy: null, policy_revision: 1, health_checked_at: null, operations_enabled: true, available_operations: [], created_at: '2026-11-01T00:00:00.000Z', ...over })

async function mount(data: unknown) {
  const sfc = loadSfc('components/vendor/TenantOperationsPanel.vue', {
    useI18n: () => ({ t: (key: string) => key, te: () => false }), keyLabel, useVendorApi: () => ({ request: async () => ({}) }),
    useVendorContext: () => ({ can: () => true }),
    useVendorTenant: () => ({ data: Vue.ref(data), error: Vue.ref(null), pending: Vue.ref(false), refresh: async () => {} }),
    useVendorCatalogVersions: () => ({ load: () => ({ data: Vue.ref([]) }) }),
    useTenantRecentOperations: () => ({ data: Vue.ref([]), error: Vue.ref(null), pending: Vue.ref(false), refresh: async () => {} }),
    formatBusinessDateTime: (value: string) => value, operationStatusBadge: () => ({ tone: 'neutral' }), buildVendorPolicy: () => ({}), failureKey: (_: unknown, key: string) => key,
    showsSharedBackups, navigateTo: async () => {},
  })
  return sfc.mount({ tenantId })
}
const render = async (data: unknown) => (await mount(data)).render()
const names = (captured: { name: string }[]) => captured.map(entry => entry.name)

describe('the backups section of the operations tab', () => {
  it('shows for a shared workspace even though no operation is offered, without the unavailable hint', async () => {
    const { captured } = await render(tenant())
    expect(names(captured)).toContain('VendorBackupsPanel')
    expect(captured.find(entry => entry.name === 'VendorBackupsPanel')!.attrs['tenant-id']).toBe(tenantId)
    expect(captured.some(entry => entry.name === 'UAlert' && entry.attrs.title === 'vendor.tenants.operationsUnavailableHint')).toBe(false)
  })
  it.each(['dedicated_managed', 'customer_hosted'])('is hidden for a %s workspace, which keeps its own operations form and hint', async hosting_model => {
    const { captured } = await render(tenant({ hosting_model }))
    expect(names(captured)).not.toContain('VendorBackupsPanel')
    expect(captured.some(entry => entry.name === 'UAlert' && entry.attrs.title === 'vendor.tenants.operationsUnavailableHint')).toBe(true)
  })
  it('counts a reason typed in the backups section as unsent input for the page', async () => {
    const mounted = await mount(tenant())
    const attrs = (await mounted.render()).captured.find(entry => entry.name === 'VendorBackupsPanel')!.attrs
    expect(mounted.state.dirtyModel.value).toBe(false)
    ;(attrs['onUpdate:dirty'] as (value: boolean) => void)(true); await Vue.nextTick()
    expect(mounted.state.dirtyModel.value).toBe(true)
    ;(attrs['onUpdate:dirty'] as (value: boolean) => void)(false); await Vue.nextTick()
    expect(mounted.state.dirtyModel.value).toBe(false)
  })
})
