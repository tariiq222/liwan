import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleViewSchema, invoiceSchema, orderSchema, packageRevisionSchema, paymentAttemptSchema, planViewSchema, quoteSchema } from '@nasq/commercial-contracts'
import { handleCommercial } from '../../e2e/commercial-mock-routes.mjs'

// The stub control plane serves these records to the mock e2e. They must be valid wire shapes, or a
// page spec would pass against data the real control plane can never send. Plans and bundles are parsed
// with the view schemas: the list endpoints send the revision plus the view extras.
const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../e2e/commercial-fixtures.json'), 'utf8'))

describe('commercial e2e fixtures', () => {
  it('invoices, plans, bundles, orders and attempts parse with the contract schemas', () => {
    // The vendor list adds the customer's name next to the exact customer-facing invoice.
    for (const { customer_name: name, ...invoice } of fixtures.invoices.items) expect(() => invoiceSchema.parse(invoice), invoice.id).not.toThrow()
    for (const plan of fixtures.plans.items) expect(() => planViewSchema.parse(plan), plan.id).not.toThrow()
    for (const bundle of fixtures.bundles.items) expect(() => bundleViewSchema.parse(bundle), bundle.id).not.toThrow()
    for (const pkg of fixtures.catalog.items) expect(() => packageRevisionSchema.parse(pkg), pkg.id).not.toThrow()
    for (const attempt of fixtures.paymentAttempts['order-beta'].items) expect(() => paymentAttemptSchema.parse(attempt)).not.toThrow()
    expect(() => orderSchema.parse(fixtures.customers.items.find((c: { id: string }) => c.id === 'cust-beta').subscription.pending_order)).not.toThrow()
  })

  it('carries the fixed counts the page specs rely on', () => {
    expect(fixtures.customers.total).toBe(3)
    expect(fixtures.invoices.total).toBe(3)
    expect(fixtures.audit.total).toBe(60)
  })
})

function stubResponse(method: string, path: string) {
  let status = 0
  let body: unknown
  const response = {
    writeHead(code: number) { status = code },
    end(raw: string) { body = JSON.parse(raw) },
  }
  handleCommercial({ method }, response, new URL(path, 'http://localhost'))
  return { status, body }
}

describe('commercial mock read operations', () => {
  it('serves a schema-valid quote preview without accepting orders or catalog mutations', () => {
    const result = stubResponse('POST', '/v1/commercial/quotes')
    expect(result.status).toBe(200)
    expect(quoteSchema.parse(result.body).lines.length).toBeGreaterThan(0)
    expect(stubResponse('POST', '/v1/commercial/orders').status).toBe(501)
    expect(stubResponse('POST', '/v1/commercial/plans').status).toBe(501)
    expect(stubResponse('PATCH', '/v1/commercial/quotes').status).toBe(501)
  })

  it('reads existing package revisions and rejects missing ones', () => {
    const pkg = fixtures.catalog.items[0]
    const result = stubResponse('GET', `/v1/packages/${pkg.id}`)
    expect(result.status).toBe(200)
    expect(packageRevisionSchema.parse(result.body)).toEqual(pkg)
    expect(stubResponse('GET', '/v1/packages/missing').status).toBe(404)
  })
})
