import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { refDebounced } from '@vueuse/core'
import { invoiceStatusBadge } from '@liwan/commercial-ui/app/utils/commercialBadges'
import { formatCommercialMoney } from '@liwan/commercial-ui/app/utils/commercial'
import { mountPage } from '../../__tests__/pageHarness'
import * as invoiceExport from '../../utils/invoiceExport'
import * as subscriptions from '../../utils/vendorSubscriptions'
import { formatBusinessDate } from '../../utils/vendorTime'

const mounted: { stop: () => void }[] = []
afterEach(() => mounted.splice(0).forEach(page => page.stop()))

const sar = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
const invoice = (n: number) => ({ id: `inv-${n}`, number: `INV-${n}`, customer_id: `cus-${n}`, customer_name: `Customer ${n}`, kind: 'renewal', status: 'issued', currency: 'SAR', subtotal: sar(1000), tax: sar(0), total: sar(1000),
  period_start: '2026-10-02', period_end: '2026-11-02', issued_at: '2026-10-01T22:00:00Z', due_at: null, paid_at: null, adjustments: [] })

/** A list of `total` invoices; `fail` makes the nth request (1-based) fail. */
async function listPage(total: number, { query = {}, fail = 0 }: { query?: Record<string, string>, fail?: number } = {}) {
  const requests: Record<string, unknown>[] = []
  const listInvoices = vi.fn(async (q: { limit: number, offset: number }) => {
    requests.push(q)
    if (requests.length === fail) throw new Error('upstream')
    return { items: Array.from({ length: Math.max(0, Math.min(q.limit, total - q.offset)) }, (_, i) => invoice(total - (q.offset + i))), total, summary: { outstanding: [] } }
  })
  const downloadCsv = vi.fn()
  const page = await mountPage('invoices/index.vue', {
    ...subscriptions, ...invoiceExport, downloadCsv, invoiceStatusBadge, formatCommercialMoney, formatBusinessDate, refDebounced, riyadhDate: () => '2026-11-22',
    useRoute: () => ({ query, fullPath: '/invoices' }), useRouter: () => ({ replace: vi.fn() }),
    useVendorSubscriptions: () => ({ listInvoices, listClients: vi.fn(async () => ({ items: [], total: 0 })) }),
  })
  mounted.push(page)
  return { ...page, requests, downloadCsv, listInvoices }
}
const node = (captured: { name: string, props: Record<string, any> }[], testid: string) => captured.find(entry => entry.props['data-testid'] === testid)

describe('invoice list export', () => {
  it('exports every invoice that matches the filters, not only the visible page, as one file', async () => {
    const { state, requests, downloadCsv } = await listPage(260, { query: { customer_id: 'cus-9', status: 'issued' } })
    requests.length = 0
    await state.exportCsv()
    expect(requests.map(q => [q.customer_id, q.status, q.limit, q.offset])).toEqual([['cus-9', 'issued', 200, 0], ['cus-9', 'issued', 200, 200]])
    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [name, csv] = downloadCsv.mock.calls[0]!
    expect(name).toBe('liwan-invoices-issued-2026-11-22.csv')
    expect(csv.split('\r\n')).toHaveLength(260 + 2)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('INV-1,')
    expect(csv).toContain(',10.00,')
  })

  it('exports 5,000 rows at most, names the file -partial and says so on the page', async () => {
    const { state, downloadCsv, rendered } = await listPage(5600)
    expect(node((await rendered()).captured, 'invoice-export-cap')).toBeDefined()
    await state.exportCsv()
    expect(downloadCsv.mock.calls[0]![0]).toBe('liwan-invoices-all-2026-11-22-partial.csv')
    expect(downloadCsv.mock.calls[0]![1].split('\r\n')).toHaveLength(5000 + 2)
  })

  it('says nothing about a cap for a list that fits', async () => {
    expect(node((await (await listPage(40)).rendered()).captured, 'invoice-export-cap')).toBeUndefined()
  })

  it('creates no file when a page fails, and says the export failed', async () => {
    const { state, downloadCsv, rendered } = await listPage(450, { fail: 3 })
    await state.exportCsv()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(state.exporting.value).toBe(false)
    expect(node((await rendered()).captured, 'invoice-export-failure')).toBeDefined()
  })

  it('shows the progress while it reads and stops, with no file and no failure, when cancelled', async () => {
    const { state, downloadCsv, rendered, listInvoices } = await listPage(900)
    const release: (() => void)[] = []
    listInvoices.mockImplementation(() => new Promise(resolve => release.push(() => resolve({ items: Array.from({ length: 200 }, (_, i) => invoice(900 - i)), total: 900, summary: { outstanding: [] } }))))
    const running = state.exportCsv()
    await Vue.nextTick()
    expect(state.exporting.value).toBe(true)
    expect(node((await rendered()).captured, 'invoice-export-cancel')).toBeDefined()
    state.cancelExport()
    release[0]!()
    await running
    expect(state.exporting.value).toBe(false)
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(node((await rendered()).captured, 'invoice-export-failure')).toBeUndefined()
    expect(listInvoices).toHaveBeenCalledTimes(1 + 1)
  })

  it('offers the export only while there is something to export', async () => {
    expect(node((await (await listPage(0)).rendered()).captured, 'invoices-export')?.props.disabled).toBe(true)
    expect(node((await (await listPage(3)).rendered()).captured, 'invoices-export')?.props.disabled).toBe(false)
  })
})
