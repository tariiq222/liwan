import { afterEach, expect, it, vi } from 'vitest'
import { reactive, ref } from 'vue'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as ownerOnly from '../../utils/ownerOnly'
import * as commercial from '../../utils/vendorCommercial'
import * as deletion from '../../utils/vendorDeletion'
import * as clients from '../../utils/vendorClients'
import { attentionTab } from '../../utils/vendorAttention'
import { entitledSelections } from '../../utils/vendorEntitlement'
import { customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const customer = { id: 'c1', name: 'Acme', tenant_id: 't1', subscription: null }

async function customerPage(path: string, query: Record<string, string> = {}, options: { grants?: string[], subscription?: unknown } = {}) {
  const route = reactive({ path, query, params: { id: 'c1' }, fullPath: path })
  const api = {
    customer: vi.fn(async () => ({ ...customer, subscription: options.subscription ?? null })), subscription: vi.fn(async () => null), branches: vi.fn(async () => null), usage: vi.fn(async () => null),
    listInvoices: vi.fn(async () => ({ items: [], total: 0 })), attention: vi.fn(async (_customerId: string): Promise<{ items: ReturnType<typeof attentionItem>[], total: number, counts: object }> => ({ items: [], total: 0, counts: {} })), tenantDeletionRun: vi.fn(async () => ({ run: null })),
  }
  const catalog = { listPlans: vi.fn(async () => ({ items: [], total: 0 })), releases: vi.fn(async () => []) }
  const tenantId = ref('')
  const page = await mountPage('customers/[id].vue', {
    ...subscriptions, ...ownerOnly, ...commercial, ...deletion, ...clients, attentionTab, entitledSelections, customerDisplayBadge, operationStatusBadge, invoiceStatusBadge, formatCommercialMoney, formatLiwanDate, formatLiwanDateTime,
    createError: (e: unknown) => e, useCopyLink: () => ({}),
    useVendorTenant: (id: { value: string }) => { tenantId.value = id.value; return { data: ref(null), error: ref(null), pending: ref(false), refresh: vi.fn() } },
    useTenantRecentOperations: () => ({ data: ref([]), error: ref(null), refresh: vi.fn() }),
    useWorkspaceProvisioning: () => ({ error: null, provisioning: null, loginUrl: null, refreshNow: vi.fn() }),
    useRoute: () => route, useVendorContext: () => ({ can: (grant: string) => !options.grants || options.grants.includes(grant) }),
    useVendorSubscriptions: () => api, useVendorCommercial: () => catalog,
  })
  mounted.push(page)
  return { page, route, api, catalog }
}
const ownSubscription = { id: 's1', applied: null, target: null, pending_order: null, revision: 1, auto_renew: { enabled: false, consent_at: null, payment_method: null } }
function attentionItem(kind: string) { return { kind, customer_id: 'c1', tenant_id: 't1', operation_id: null, invoice_id: null, name: 'Acme', since: '2026-11-01T00:00:00Z', detail: null } }

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

it('shows the open attention items of this customer, with their reason, at the top of the tab they are resolved on', async () => {
  const { page, api } = await customerPage('/customers/c1', { tab: 'subscription' })
  api.attention.mockResolvedValue({ items: [attentionItem('billing_blocked'), attentionItem('stalled_activation')], total: 2, counts: {} })
  await page.state.refreshExtra()
  expect(api.attention).toHaveBeenCalledWith('c1')
  const list = (await page.rendered()).captured.filter(node => node.name === 'VendorAttentionList')
  expect(list).toHaveLength(1)
  expect(list[0]!.props.items.map((i: { kind: string }) => i.kind)).toEqual(['billing_blocked'])
})

it('shows no attention block when the customer has nothing open', async () => {
  const { page } = await customerPage('/customers/c1', { tab: 'subscription' })
  expect((await page.rendered()).captured.some(node => node.name === 'VendorAttentionList')).toBe(false)
})

it.each([
  ['pricing', ['vendor.read', 'vendor.pricing.manage']],
  ['subscriptions', ['vendor.read', 'vendor.subscriptions.manage']],
])('tells an account holding only the %s grant that custom terms are the platform owner\'s, and offers no terms button', async (_name, grants) => {
  const { page } = await customerPage('/customers/c1', { tab: 'subscription' }, { grants, subscription: ownSubscription })
  const { captured } = await page.rendered()
  expect(captured.find(node => node.name === 'VendorOwnerOnlyHint')?.props.action).toBe('customTerms')
  expect(captured.some(node => node.name === 'UButton' && node.props.to === page.state.termsTo.value)).toBe(false)
})

it('offers the terms button and no owner-only text to an account holding both grants', async () => {
  const { page } = await customerPage('/customers/c1', { tab: 'subscription' }, { subscription: ownSubscription })
  const { captured } = await page.rendered()
  expect(captured.some(node => node.name === 'VendorOwnerOnlyHint')).toBe(false)
  expect(captured.some(node => node.name === 'UButton' && node.props.to === page.state.termsTo.value)).toBe(true)
})
