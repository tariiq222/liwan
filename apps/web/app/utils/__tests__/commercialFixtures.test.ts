import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { formPaymentSessionSchema, branchSummarySchema, paymentMethodViewSchema, invoiceSchema, subscriptionViewSchema, usageSnapshotSchema } from '@liwan/commercial-contracts'

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
    expect(() => paymentMethodViewSchema.parse(fixtures.savedCard)).not.toThrow()
    expect(() => branchSummarySchema.parse(fixtures.branches)).not.toThrow()
    expect(() => usageSnapshotSchema.parse(fixtures.usage)).not.toThrow()
    for (const invoice of fixtures.invoices.items) expect(() => invoiceSchema.parse(invoice), invoice.id).not.toThrow()
  })
})

describe('the payable order of the pay page', () => {
  function post(path: string, body: unknown) {
    let status = 0
    let answer: unknown
    const listeners: Record<string, (chunk?: string) => void> = {}
    const req = { method: 'POST', on: (event: string, fn: (chunk?: string) => void) => { listeners[event] = fn } }
    const response = { writeHead(code: number) { status = code }, end(raw: string) { answer = JSON.parse(raw) } }
    const handled = handleCommercial(req, response, new URL(path, 'http://localhost'))
    listeners.data?.(JSON.stringify(body)); listeners.end?.()
    return { handled, status, answer }
  }
  it('is read as an unpaid order that its invoice names, and opens a stand-in card form session', () => {
    expect(fixtures.invoices.items.some((invoice: { order_id: string | null }) => invoice.order_id === fixtures.payOrder.id)).toBe(true)
    expect(stubResponse('GET', `/v1/customer/orders/${fixtures.payOrder.id}`).body).toEqual(fixtures.payOrder)
    expect(stubResponse('GET', '/v1/customer/orders/order-x').status).toBe(404)
    expect(() => formPaymentSessionSchema.parse(fixtures.payFormSession)).not.toThrow()
    const opened = post(`/v1/customer/orders/${fixtures.payOrder.id}/payment-attempts`, { method: 'form', save_card: false })
    expect(opened.status).toBe(201)
    expect(opened.answer).toEqual(fixtures.payFormSession)
    expect(post('/v1/customer/orders/order-x/payment-attempts', {}).status).toBe(501)
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
