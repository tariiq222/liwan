import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { mountPage } from '../../__tests__/pageHarness'
import * as subscriptions from '../../utils/vendorSubscriptions'
import * as ownerOnly from '../../utils/ownerOnly'
import * as stuckRefund from '../../utils/stuckRefund'
import * as vendorCommercial from '../../utils/vendorCommercial'
import { adjustmentStatusBadge, paymentAttemptBadge } from '../../utils/vendorBadges'
import { formatBusinessDate, formatBusinessDateTime } from '../../utils/vendorTime'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const stuck = { since: '2026-11-22T06:00:00.000Z', attempts: 2, next_attempt_at: '2026-11-22T09:00:00.000Z', provider_payment_id: null, conflict: null, actions: ['check', 'release'] }
const note = (over: Record<string, unknown> = {}) => ({ id: 'note1', invoice_id: 'inv1', customer_id: 'c1', kind: 'credit_note', reason: 'Customer asked for the money back', amount: sar(11500), status: 'pending', origin: 'vendor',
  created_at: '2026-11-22T05:00:00Z', created_by: 'v:1', refund_reference: null, refunded_at: null, refunded_by: null, manual_record_allowed: false,
  automatic_refund: { state: 'provider_unverified', reason: null, stuck }, ...over })
const invoice = (adjustments: unknown[]) => ({ id: 'inv1', number: 'INV-1', order_id: 'o1', customer_id: 'c1', customer_name: 'x', kind: 'initial', status: 'paid', currency: 'SAR', lines: [], subtotal: sar(11500), tax: sar(0), total: sar(11500),
  period_start: '2026-10-02', period_end: '2026-11-02', issued_at: null, due_at: null, paid_at: null, tax_label: null, adjustments, bank_transfer_claim: null,
  refund: { refundable: false, first_payment: true, until: null, window_days: 14, locks_subscription: false } })

async function invoicePage(adjustments: unknown[], grants = ['vendor.read', 'vendor.billing.manage']) {
  const api = { invoice: vi.fn(async () => invoice(adjustments)), paymentAttempts: vi.fn(async () => ({ items: [], total: 0 })) }
  const page = await mountPage('invoices/[id].vue', {
    ...subscriptions, ...ownerOnly, ...stuckRefund, ...vendorCommercial, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney, formatBusinessDate, formatBusinessDateTime,
    useRoute: () => ({ params: { id: 'inv1' }, query: {} }), useVendorContext: () => ({ can: (grant: string) => grants.includes(grant) }), useCopyLink: () => ({ copy: vi.fn(), outcomeFor: () => null }),
    useVendorSubscriptions: () => api,
  })
  mounted.push(page)
  const { captured } = await page.rendered()
  return { api, page, actions: captured.filter(entry => entry.name === 'VendorStuckRefundActions') }
}

describe('the invoice page and a stuck automatic refund', () => {
  it('shows the stuck refund actions for a pending credit note in a stuck state, to an account that manages billing', async () => {
    const { actions } = await invoicePage([note()])
    expect(actions).toHaveLength(1)
    expect(actions[0]!.props.note).toMatchObject({ id: 'note1' })
  })

  it.each([
    ['not stuck', note({ automatic_refund: { state: 'in_progress', reason: null, stuck: null } })],
    ['without an automatic refund', note({ automatic_refund: null, manual_record_allowed: true })],
    ['already refunded', note({ status: 'refunded', refund_reference: 'MOY-1', refunded_at: '2026-11-22T08:00:00Z', refunded_by: 'system' })],
    ['void', note({ status: 'void' })],
  ])('shows no stuck refund actions for a note that is %s', async (_name, subject) => {
    expect((await invoicePage([subject])).actions).toHaveLength(0)
  })

  it('shows none without the billing grant', async () => {
    expect((await invoicePage([note()], ['vendor.read'])).actions).toHaveLength(0)
  })

  it('reloads the invoice when an action reports a change, and keeps the manual form closed for a stuck note', async () => {
    const { api, page, actions } = await invoicePage([note()])
    const before = api.invoice.mock.calls.length
    await actions[0]!.props.onChanged()
    expect(api.invoice.mock.calls.length).toBe(before + 1)
    expect(page.state.canRecordRefund.value).toBe(true)
    expect((await page.rendered()).html).not.toContain('record-refund-action')
  })
})
