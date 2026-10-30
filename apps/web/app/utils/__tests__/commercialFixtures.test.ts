import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { branchSummarySchema, invoiceSchema, subscriptionViewSchema, usageSnapshotSchema } from '@liwan/commercial-contracts'

// The stub control plane serves these records to the mock e2e. They must be valid wire shapes, or a
// page spec would pass against data the real control plane can never send.
import { handleCommercial } from '../../../e2e/commercial-mock-routes.mjs'

const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../e2e/commercial-fixtures.json'), 'utf8'))

function stubResponse(method: string, path: string) {
  let status = 0
  let body: unknown
  const response = {
    writeHead(code: number) { status = code },
    end(raw: string) { body = JSON.parse(raw) },
  }
  const handled = handleCommercial({ method }, response, new URL(path, 'http://localhost'))
  return { handled, status, body }
}

describe('customer commercial e2e fixtures', () => {
  it('the subscription, branches, usage and invoices parse with the contract schemas', () => {
    expect(() => subscriptionViewSchema.parse(fixtures.subscription)).not.toThrow()
    expect(() => branchSummarySchema.parse(fixtures.branches)).not.toThrow()
    expect(() => usageSnapshotSchema.parse(fixtures.usage)).not.toThrow()
    for (const invoice of fixtures.invoices.items) expect(() => invoiceSchema.parse(invoice), invoice.id).not.toThrow()
  })
})

describe('customer commercial mock read operations', () => {
  it('serves invoices and fails closed on unknown ids and mutations', () => {
    const invoice = fixtures.invoices.items[0]
    expect(stubResponse('GET', `/v1/customer/invoices/${invoice.id}`).body).toEqual(invoice)
    expect(stubResponse('GET', '/v1/customer/invoices/missing').status).toBe(404)
    expect(stubResponse('POST', '/v1/customer/orders').status).toBe(501)
  })

  it('leaves every other path to the rest of the mock', () => {
    expect(stubResponse('GET', '/v1/tenants').handled).toBe(false)
    expect(stubResponse('POST', '/v1/commercial/quotes').handled).toBe(false)
  })
})
