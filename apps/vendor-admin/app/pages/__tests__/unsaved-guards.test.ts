import { afterEach, expect, it, vi } from 'vitest'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as ownerOnly from '../../utils/ownerOnly'
import * as commercial from '../../utils/vendorCommercial'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { adjustmentStatusBadge, paymentAttemptBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { formatLiwanDate, formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { canPublishRestore } from '../../utils/restorePublication'
import { operationTargetTo } from '../../utils/vendorOperations'
import { canAbandonJob } from '../../utils/sharedJobAbandon'
import { canRecoverJob, recoveryTextKey } from '../../utils/sharedJobRecovery'
import { mountPage } from '../../__tests__/pageHarness'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const guardOf = async (page: Awaited<ReturnType<typeof mountPage>>) => (await page.rendered()).captured.find(node => node.name === 'SharedUnsavedChanges')

const money = { minor: 12345, exponent: 2, currency: 'SAR' }
const invoice = { id: 'invoice1', order_id: 'order1', customer_id: 'customer1', status: 'paid', kind: 'initial', total: money, subtotal: money, tax: { ...money, minor: 0 }, tax_label: null, due_at: null,
  period_start: '2026-10-01', period_end: '2026-11-01', lines: [], adjustments: [], refund: { refundable: true, first_payment: true, until: '2026-12-20T23:59:59+03:00', window_days: 14, locks_subscription: false } }

async function invoicePage() {
  const api = {
    invoice: vi.fn(async () => invoice), paymentAttempts: vi.fn(async () => ({ items: [], total: 0 })),
    requestRefund: vi.fn(async () => ({})), refundCreditNote: vi.fn(async () => ({})), recordBankTransfer: vi.fn(async () => ({})), voidRenewalInvoice: vi.fn(async () => ({})), refundAiTopup: vi.fn(async () => ({})),
  }
  const page = await mountPage('invoices/[id].vue', {
    ...subscriptions, ...ownerOnly, ...commercial, formatLiwanDate, formatLiwanDateTime, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney,
    useRoute: () => ({ params: { id: 'invoice1' }, path: '/invoices/invoice1', query: {} }),
    useVendorContext: () => ({ can: () => true }), useVendorSubscriptions: () => api,
  })
  mounted.push(page)
  return { page, api }
}

it('guards each form of the invoice page while it holds typed input, and releases it after a successful submit', async () => {
  const { page, api } = await invoicePage()
  const { state } = page
  expect((await guardOf(page))?.props.dirty).toBe(false)

  state.openRequest(); expect((await guardOf(page))?.props.dirty).toBe(false)
  state.requestReason.value = 'Customer asked on day 3'
  expect((await guardOf(page))?.props.dirty).toBe(true)
  await state.requestRefund()
  expect(api.requestRefund).toHaveBeenCalled()
  expect((await guardOf(page))?.props.dirty).toBe(false)

  state.openRefund('note1'); state.refundReason.value = 'Sent from the bank'
  expect((await guardOf(page))?.props.dirty).toBe(true)
  state.closeRefund(); expect((await guardOf(page))?.props.dirty).toBe(false)

  state.openTransfer(); expect((await guardOf(page))?.props.dirty).toBe(false)
  state.transferReference.value = 'REF-1'
  expect((await guardOf(page))?.props.dirty).toBe(true)
  state.closeTransfer(); expect((await guardOf(page))?.props.dirty).toBe(false)

  state.openTransfer(); state.transferAmount.value = '1'
  expect((await guardOf(page))?.props.dirty).toBe(true)
  state.closeTransfer()

  state.openVoid(); state.voidReason.value = 'Customer will not pay'
  expect((await guardOf(page))?.props.dirty).toBe(true)
  state.closeVoid(); expect((await guardOf(page))?.props.dirty).toBe(false)
})

async function operationPage(data: unknown, navigateTo = vi.fn()) {
  const request = vi.fn(async (path: string) => (path.startsWith('operations/') && !path.endsWith('/retry') ? data : { id: 'op2' }))
  const page = await mountPage('operations/[id].vue', {
    formatLiwanDateTime, operationStatusBadge, safeReturnTo, canPublishRestore, ...ownerOnly, operationTargetTo, canAbandonJob, canRecoverJob, recoveryTextKey, failureKey: () => 'k',
    useRoute: () => ({ params: { id: 'op1' }, query: {} }), useVendorApi: () => ({ request }), useVendorContext: () => ({ can: () => true }), navigateTo,
  })
  mounted.push(page)
  return { page, request, navigateTo }
}

it('guards the reasons of the operation page while their form is open', async () => {
  const { page } = await operationPage(null)
  const { state } = page
  expect((await guardOf(page))?.props.dirty).toBe(false)
  for (const [open, reason] of [['publishOpen', 'publishReason'], ['recoverOpen', 'recoverReason'], ['abandonOpen', 'abandonReason']] as const) {
    state[reason].value = 'typed reason'
    expect((await guardOf(page))?.props.dirty, `${reason} while closed`).toBe(false)
    state[open].value = true
    expect((await guardOf(page))?.props.dirty, `${reason} while open`).toBe(true)
    state[open].value = false; state[reason].value = ''
  }
  state.reason.value = 'retry because'
  expect((await guardOf(page))?.props.dirty).toBe(true)
})

it('does not ask when the retry succeeds and the page moves to the new operation', async () => {
  const seen: unknown[] = []
  const operation = { id: 'op1', tenant_id: 't1', request_id: 'r', type: 'tenant.inspect', status: 'failed', stage: 'failed', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', events: [] }
  const holder: { page?: Awaited<ReturnType<typeof mountPage>> } = {}
  const navigateTo = vi.fn(async () => { seen.push((await guardOf(holder.page!))?.props.dirty) })
  const { page } = await operationPage(operation, navigateTo)
  holder.page = page
  page.state.reason.value = 'retry because'
  await page.state.retry()
  expect(navigateTo).toHaveBeenCalled()
  expect(seen).toEqual([false])
})

it('guards the change page while the order is being shaped and releases it once placed', async () => {
  const plan = { id: 'plan1', name: 'Basic', trial_days: 0, prices: [{ cadence: { unit: 'month' as const, count: 1 } }], optional_bundle_revision_ids: [], included_bundle_revision_ids: [], included_users: 1, included_storage_mb: 1024 }
  const customer = { id: 'c1', subscription: null }
  const seen: unknown[] = []
  const holder: { page?: Awaited<ReturnType<typeof mountPage>> } = {}
  const api = { customer: vi.fn(async () => customer), subscription: vi.fn(async () => null), changeQuote: vi.fn(async () => ({ id: 'q1' })), placeOrder: vi.fn(async () => ({})) }
  const catalog = { listPlans: vi.fn(async () => ({ items: [plan] })), listBundles: vi.fn(async () => ({ items: [] })) }
  const navigateTo = vi.fn(async () => { seen.push((await guardOf(holder.page!))?.props.dirty) })
  const page = await mountPage('customers/[id]/change.vue', {
    ...subscriptions, ...commercial, cadenceLabel: () => '', crypto: { randomUUID: () => 'key' },
    useRoute: () => ({ params: { id: 'c1' }, query: {} }), useVendorContext: () => ({ can: () => true }), useVendorSubscriptions: () => api, useVendorCommercial: () => catalog,
    navigateTo, refreshNuxtData: vi.fn(),
  })
  mounted.push(page); holder.page = page
  expect((await guardOf(page))?.props.dirty).toBe(false)
  page.state.choosePlan('plan1')
  expect((await guardOf(page))?.props.dirty).toBe(true)
  page.state.cadence.value = commercial.cadenceKey(plan.prices[0]!.cadence)
  await page.state.recompute()
  await page.state.place()
  expect(api.placeOrder).toHaveBeenCalled()
  expect(seen).toEqual([false])
})
