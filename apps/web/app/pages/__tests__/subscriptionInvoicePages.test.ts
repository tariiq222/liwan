import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(import.meta.dirname, '../..', p), 'utf8')

describe('invoice print page and download action', () => {
  const print = read('pages/subscription/invoices/print/[id].vue')
  it('gates the print page and the print button on billing.read', () => {
    expect(print).toContain("can('billing.read')")
    expect(print).toMatch(/<SharedForbiddenState v-if="!allowed"/)
    expect(print).toMatch(/<UButton v-if="allowed"[^>]*invoice-print-action/)
  })
  it('offers the download only to a reader of the invoice, with an accessible name', () => {
    const page = read('pages/subscription/invoices/[id].vue')
    const forbidden = page.indexOf('<SharedForbiddenState v-if="!allowed"')
    const action = page.indexOf('data-testid="invoice-download"')
    expect(forbidden).toBeGreaterThan(-1)
    expect(action).toBeGreaterThan(forbidden)
    expect(page).toMatch(/invoice-download|:label="t\('subscription\.invoices\.print\.download'\)"/)
    expect(page).toContain(":label=\"t('subscription.invoices.print.download')\"")
  })
})

describe('invoice list download action', () => {
  const list = read('pages/subscription/invoices/index.vue')
  it('offers each row a download icon button with an accessible name, in the table and the stacked row', () => {
    expect(list.match(/data-testid="invoice-row-download"/g)).toHaveLength(2)
    expect(list.match(/:aria-label="printLabel\(inv\)"/g)).toHaveLength(2)
    expect(list).toContain("t('subscription.invoices.print.rowAction'")
    expect(list).toContain('/subscription/invoices/print/')
  })
  it('stays behind the billing.read gate of the list', () => {
    expect(list).toContain("can('billing.read')")
    expect(list).toMatch(/<SharedListCard v-if="allowed">/)
  })
})
