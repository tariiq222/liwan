import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { adjustmentStatusBadge } from '../../utils/vendorBadges'
import { recordResolutions } from '../../utils/stuckRefund'
import { refundErrorKey, validRefundReason } from '../../utils/vendorSubscriptions'
import { formatBusinessDateTime } from '../../utils/vendorTime'
import { loadSfc } from './sfc'

const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const conflict = (over: Record<string, unknown> = {}) => ({ adjustment_id: 'holder', invoice_id: 'invoice-9', invoice_number: 'INV-9', amount: money(11500), cause: 'provider_refund', status: 'refunded',
  refunded_by: 'vendor:9', refunded_at: '2026-11-22T07:00:00.000Z', same_invoice: false, ...over })
const note = (stuck: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({ id: 'note1', invoice_id: 'invoice-1', kind: 'credit_note', status: 'pending', amount: money(11500),
  automatic_refund: { state: 'provider_unverified', reason: null, stuck }, ...over })
const attempted = { since: '2026-11-22T06:00:00.000Z', attempts: 3, next_attempt_at: '2026-11-22T09:00:00.000Z', provider_payment_id: null, conflict: null, actions: ['check', 'release'], release_from: '2026-11-22T10:00:00.000Z' }
const returned = (over: Record<string, unknown> = {}) => ({ ...attempted, provider_payment_id: 'pay_123', conflict: conflict(), actions: ['check', 'record'], release_from: null, ...over })

function mounted(api: Record<string, unknown> = {}) {
  const fullApi = { checkStuckRefund: vi.fn(async () => ({ invoice: {}, provider: { status: 'succeeded', payment_id: 'pay_123', refunded: null } })), releaseRefundHold: vi.fn(async () => ({ invoice: {}, provider: null })),
    recordReturnedRefund: vi.fn(async () => ({ invoice: {}, provider: null })), ...api }
  const sfc = loadSfc('components/vendor/StuckRefundActions.vue', { useI18n: () => ({ t: (key: string) => key, locale: Vue.ref('en') }), useHydrated: () => Vue.ref(true), useVendorSubscriptions: () => fullApi,
    formatCommercialMoney, adjustmentStatusBadge, recordResolutions, refundErrorKey, validRefundReason, formatBusinessDateTime })
  return { sfc, api: fullApi }
}
/** Everything the template rendered: its own markup, and the test ids it handed to child components (which the stubs do not print). */
async function painted(sfc: ReturnType<typeof mounted>['sfc'], props: Record<string, unknown>) {
  const view = sfc.mount(props); const { html, captured } = await view.render()
  const ids = captured.map(item => item.attrs['data-testid']).filter(Boolean) as string[]
  return { html, ids, view, has: (id: string) => ids.includes(id) || html.includes(`data-testid="${id}"`) }
}
const buttons = (page: Awaited<ReturnType<typeof painted>>) => ['check', 'release', 'record'].filter(action => page.has(`stuck-refund-${action}`))

describe('StuckRefundActions', () => {
  it('shows an attempted row\'s facts with the check and release actions, no conflict and no record action', async () => {
    const page = await painted(mounted().sfc, { note: note(attempted) })
    expect(page.has('stuck-refund')).toBe(true); expect(page.html).toContain('vendor.invoices.refund.stuck.noPaymentId')
    expect(buttons(page)).toEqual(['check', 'release'])
    expect(page.has('stuck-refund-conflict')).toBe(false)
    expect(page.html).toContain('vendor.invoices.refund.stuck.releaseFrom'); expect(page.html).toContain(formatBusinessDateTime('2026-11-22T10:00:00.000Z'))
  })

  it('shows a returned row\'s payment id, the conflicting note and the check and record actions, never release', async () => {
    const page = await painted(mounted().sfc, { note: note(returned(), { automatic_refund: { state: 'refunded_recording', reason: 'refund_reference_in_use', stuck: returned() } }) })
    expect(buttons(page)).toEqual(['check', 'record'])
    expect(page.html).toContain('pay_123'); expect(page.has('stuck-refund-conflict')).toBe(true); expect(page.html).toContain('INV-9')
    expect(page.has('stuck-refund-conflict-link')).toBe(true)
    expect(page.html).not.toContain('vendor.invoices.refund.stuck.releaseFrom')
    expect(page.html).toContain('vendor.invoices.refund.stuck.conflict.causes.provider_refund')
    expect(page.html).toContain('vendor.invoices.adjustmentStatus.refunded')
  })

  it('names a conflict on the same invoice without a link', async () => {
    const page = await painted(mounted().sfc, { note: note(returned({ conflict: conflict({ same_invoice: true, invoice_id: 'invoice-1' }) })) })
    expect(page.html).toContain('vendor.invoices.refund.stuck.conflict.sameInvoice'); expect(page.has('stuck-refund-conflict-link')).toBe(false)
  })

  it('shows nothing for a note that is not stuck', async () => {
    const { sfc } = mounted()
    expect((await painted(sfc, { note: note(null, { automatic_refund: { state: 'in_progress', reason: null, stuck: null } }) })).has('stuck-refund')).toBe(false)
    expect((await painted(sfc, { note: note(null, { automatic_refund: null }) })).has('stuck-refund')).toBe(false)
  })

  it('asks the page to open a form instead of opening it, and tells the page when it holds typed text', async () => {
    const emit = vi.fn()
    const view = mounted().sfc.mount({ note: note(attempted), form: null }, emit)
    view.state.open('release'); view.state.open('record'); view.state.close()
    expect(emit.mock.calls).toEqual([['open', 'release'], ['open', 'record'], ['close']])
    expect((await view.render()).captured.some(item => item.name === 'SharedInlineConfirm')).toBe(false)
    const draft = mounted().sfc.mount({ note: note(attempted), form: 'release' }, emit)
    draft.state.reason.value = 'A reason'; await Promise.resolve()
    expect(emit).toHaveBeenCalledWith('draft', true)
  })

  it('offers only the actions the server allows', async () => {
    expect(buttons(await painted(mounted().sfc, { note: note({ ...attempted, actions: ['check'] }) }))).toEqual(['check'])
  })

  it('checks again, shows the provider\'s figures and tells the page to reload', async () => {
    const { sfc, api } = mounted()
    const emit = vi.fn()
    const view = sfc.mount({ note: note(attempted) }, emit)
    await view.state.check()
    expect(api.checkStuckRefund).toHaveBeenCalledWith('note1')
    expect(emit).toHaveBeenCalledWith('changed')
    const html = (await view.render()).html
    expect(html).toContain('data-testid="stuck-refund-check-result"'); expect(html).toContain('vendor.invoices.refund.stuck.check.status.succeeded'); expect(html).toContain('vendor.invoices.refund.stuck.check.none')
  })

  it('releases the hold only with a valid reason, then closes the form and reloads', async () => {
    const { sfc, api } = mounted()
    const emit = vi.fn()
    const view = sfc.mount({ note: note(attempted), form: 'release' }, emit)
    expect((await view.render()).captured.find(item => item.name === 'SharedInlineConfirm')?.attrs.disabled).toBe(true)
    await view.state.submit(); expect(api.releaseRefundHold).not.toHaveBeenCalled()
    view.state.reason.value = '  The provider shows nothing refunded  '
    expect(view.state.dirty.value).toBe(true)
    expect((await view.render()).captured.find(item => item.name === 'SharedInlineConfirm')?.attrs.disabled).toBe(false)
    await view.state.submit()
    expect(api.releaseRefundHold).toHaveBeenCalledTimes(1)
    expect(api.releaseRefundHold).toHaveBeenCalledWith('note1', { reason: '  The provider shows nothing refunded  ' })
    expect(emit).toHaveBeenCalledWith('close'); expect(emit).toHaveBeenCalledWith('changed')
  })

  it('records the returned refund with the chosen resolution, offering already_recorded only when it can apply', async () => {
    const { sfc, api } = mounted()
    const other = sfc.mount({ note: note(returned()), form: 'record' })
    expect(other.state.resolutions.value).toEqual(['record'])
    const same = sfc.mount({ note: note(returned({ conflict: conflict({ same_invoice: true }) })), form: 'record' })
    expect(same.state.resolutions.value).toEqual(['record', 'already_recorded'])
    same.state.reason.value = 'Another note credits this money'; same.state.resolution.value = 'already_recorded'
    await same.state.submit()
    expect(api.recordReturnedRefund).toHaveBeenCalledWith('note1', { reason: 'Another note credits this money', resolution: 'already_recorded' })
    other.state.reason.value = 'The money is back'
    await other.state.submit()
    expect(api.recordReturnedRefund).toHaveBeenLastCalledWith('note1', { reason: 'The money is back', resolution: 'record' })
  })

  it('shows the server\'s refusal in words, keeps the form and the typed reason, and still reloads', async () => {
    const { sfc, api } = mounted({ releaseRefundHold: vi.fn(async () => { throw { statusCode: 409, data: { code: 'provider_refund_partial' } } }) })
    const emit = vi.fn()
    const view = sfc.mount({ note: note(attempted), form: 'release' }, emit)
    view.state.reason.value = 'Try the release'
    await view.state.submit()
    expect(api.releaseRefundHold).toHaveBeenCalledTimes(1)
    expect(view.state.failure.value).toBe('vendor.invoices.refund.errors.provider_refund_partial')
    expect(emit).not.toHaveBeenCalledWith('close'); expect(view.state.reason.value).toBe('Try the release')
    expect(emit).toHaveBeenCalledWith('changed')
    expect((await view.render()).html).toContain('vendor.invoices.refund.errors.provider_refund_partial')
  })

  it('sends one call at a time', async () => {
    let finish!: () => void
    const { sfc, api } = mounted({ releaseRefundHold: vi.fn(() => new Promise(resolve => { finish = () => resolve({ invoice: {}, provider: null }) })) })
    const view = sfc.mount({ note: note(attempted), form: 'release' })
    view.state.reason.value = 'A reason'
    const first = view.state.submit(); await view.state.submit()
    expect(api.releaseRefundHold).toHaveBeenCalledTimes(1)
    finish(); await first
  })
})
