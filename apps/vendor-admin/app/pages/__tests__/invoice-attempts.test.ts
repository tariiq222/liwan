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
const invoice = { id: 'inv1', number: 'INV-1', order_id: 'o1', customer_id: 'c1', customer_name: 'x', kind: 'renewal', status: 'paid', currency: 'SAR', lines: [], subtotal: sar(100), tax: sar(0), total: sar(100),
  period_start: '2026-10-02', period_end: '2026-11-02', issued_at: null, due_at: null, paid_at: null, tax_label: null, adjustments: [], bank_transfer_claim: null, refund: { refundable: false, first_payment: false, until: null, window_days: 0, locks_subscription: false } }
const attempt = (n: number, kind: string, providerRef: string | null) => ({ id: `a${n}`, order_id: 'o1', invoice_id: 'inv1', provider: 'moyasar', mode: 'test', kind, provider_ref: providerRef, amount: sar(100), status: 'succeeded', redirect_url: null, created_at: '2026-10-03T08:00:00Z', updated_at: '2026-10-03T08:00:00Z' })

async function invoicePage(attempts: unknown[]) {
  const copy = vi.fn()
  const page = await mountPage('invoices/[id].vue', {
    ...subscriptions, ...ownerOnly, ...stuckRefund, ...vendorCommercial, invoiceStatusBadge, adjustmentStatusBadge, paymentAttemptBadge, formatCommercialMoney, formatBusinessDate, formatBusinessDateTime,
    useRoute: () => ({ params: { id: 'inv1' }, query: {} }), useVendorContext: () => ({ can: () => true }), useCopyLink: () => ({ copy, outcomeFor: (value: string) => (value === 'copied-ref' ? 'copied' : null) }),
    useVendorSubscriptions: () => ({ invoice: vi.fn(async () => invoice), paymentAttempts: vi.fn(async () => ({ items: attempts, total: attempts.length })) }),
  })
  mounted.push(page)
  const { html, captured } = await page.rendered()
  return { html, captured, copy }
}
const copies = (captured: { name: string, props: Record<string, any> }[]) => captured.filter(entry => entry.props['data-testid'] === 'attempt-ref-copy')

describe('payment attempt kind and provider reference', () => {
  it.each(['hosted_invoice', 'form', 'saved_card', 'bank_transfer'])('shows the %s kind with its reference, left to right in a monospace face', async (kind) => {
    const { html } = await invoicePage([attempt(1, kind, 'pay_8f3a')])
    expect(html).toContain(`vendor.invoices.attemptKind.${kind}`)
    expect(html).toMatch(/<bdi dir="ltr"[^>]*font-mono[^>]*data-testid="attempt-ref"[^>]*>pay_8f3a<\/bdi>|<bdi[^>]*data-testid="attempt-ref"[^>]*dir="ltr"[^>]*>pay_8f3a<\/bdi>/)
  })

  it('shows no reference and no copy button for an attempt without one', async () => {
    const { html, captured } = await invoicePage([attempt(1, 'form', null)])
    expect(html).toContain('vendor.invoices.attemptKind.form')
    expect(html).not.toContain('data-testid="attempt-ref"')
    expect(copies(captured)).toHaveLength(0)
  })

  it('copies the reference of the attempt whose button is pressed', async () => {
    const { captured, copy } = await invoicePage([attempt(1, 'form', 'pay_a'), attempt(2, 'bank_transfer', 'BANK-77')])
    expect(copies(captured)).toHaveLength(2)
    copies(captured)[1]!.props.onClick()
    expect(copy).toHaveBeenCalledWith('BANK-77')
  })

  it('says the reference was copied for that reference only', async () => {
    const { html } = await invoicePage([attempt(1, 'form', 'copied-ref'), attempt(2, 'form', 'other-ref')])
    expect(html.match(/vendor\.invoices\.attemptRef\.copied/g)).toHaveLength(1)
  })
})
