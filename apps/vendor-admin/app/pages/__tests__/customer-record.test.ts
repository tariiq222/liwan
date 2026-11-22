import { afterEach, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as commercial from '../../utils/vendorCommercial'
import * as deletion from '../../utils/vendorDeletion'
import * as clients from '../../utils/vendorClients'
import { entitledSelections } from '../../utils/vendorEntitlement'
import { customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const customer = { id: 'c1', name: 'Acme', tenant_id: 't1', subscription: null }

async function customerPage(path: string) {
  const route = reactive({ path, query: {} as Record<string, string>, params: { id: 'c1' }, fullPath: path })
  const api = {
    customer: vi.fn(async () => customer), subscription: vi.fn(async () => null), branches: vi.fn(async () => null), usage: vi.fn(async () => null),
    listInvoices: vi.fn(async () => ({ items: [], total: 0 })), tenantDeletionRun: vi.fn(async () => ({ run: null })),
  }
  const catalog = { listPlans: vi.fn(async () => ({ items: [], total: 0 })), releases: vi.fn(async () => []) }
  const tenantId = ref('')
  const page = await mountPage('customers/[id].vue', {
    ...subscriptions, ...commercial, ...deletion, ...clients, entitledSelections, customerDisplayBadge, operationStatusBadge, invoiceStatusBadge, formatCommercialMoney, formatLiwanDate, formatLiwanDateTime,
    createError: (e: unknown) => e, useCopyLink: () => ({}),
    useVendorTenant: (id: { value: string }) => { tenantId.value = id.value; return { data: ref(null), error: ref(null), pending: ref(false), refresh: vi.fn() } },
    useTenantRecentOperations: () => ({ data: ref([]), error: ref(null), refresh: vi.fn() }),
    useWorkspaceProvisioning: () => ({ error: null, provisioning: null, loginUrl: null, refreshNow: vi.fn() }),
    useRoute: () => route, useVendorContext: () => ({ can: () => true }),
    useVendorSubscriptions: () => api, useVendorCommercial: () => catalog,
  })
  mounted.push(page)
  return { page, route, api, catalog }
}

it('guards the renewal and card reasons of the customer page', async () => {
  const { page } = await customerPage('/customers/c1')
  const guard = async () => (await page.rendered()).captured.find(node => node.name === 'SharedUnsavedChanges')
  expect((await guard())?.props.dirty).toBe(false)
  page.state.renewalReason.value = 'Customer asked'
  expect((await guard())?.props.dirty).toBe(true)
  page.state.closeRenewal(); expect((await guard())?.props.dirty).toBe(false)
  page.state.cardReason.value = 'Card was lost'
  expect((await guard())?.props.dirty).toBe(true)
})

it('sends no request for the customer while a child route (change, terms) is shown, and loads it when the operator goes back', async () => {
  const { page, route, api, catalog } = await customerPage('/customers/c1/change')
  expect(api.customer).not.toHaveBeenCalled()
  expect(api.listInvoices).not.toHaveBeenCalled()
  expect(api.tenantDeletionRun).not.toHaveBeenCalled()
  expect(catalog.listPlans).not.toHaveBeenCalled()
  expect(catalog.releases).not.toHaveBeenCalled()
  route.path = '/customers/c1'
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(api.customer).toHaveBeenCalledTimes(1)
  expect(api.tenantDeletionRun).toHaveBeenCalledTimes(1)
  expect(catalog.listPlans).toHaveBeenCalledTimes(1)
  void page
})
