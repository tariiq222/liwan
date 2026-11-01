// Part of the Plan 6e mock stack. A stub control plane for the customer BFF: /api/commercial/v1/<p> is
// forwarded to /v1/customer/<p>. Read-only fixtures; state-changing requests answer 501.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'commercial-fixtures.json'), 'utf8'))
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const notFound = res => json(res, 404, { code: 'not_found', message: 'Not found' })
const byId = (collection, id) => collection.items.find(item => item.id === id)

function customer(res, path) {
  const rest = path.replace('/v1/customer/', '')
  if (rest === 'subscription') return json(res, 200, fixtures.subscription)
  if (rest === 'catalog') return json(res, 200, fixtures.catalog)
  if (rest === 'usage') return json(res, 200, fixtures.usage)
  if (rest === 'branches') return json(res, 200, fixtures.branches)
  if (rest === 'invoices') return json(res, 200, { items: fixtures.invoices.items, total: fixtures.invoices.total })
  const invoice = /^invoices\/(.+)$/.exec(rest)
  if (invoice) return byId(fixtures.invoices, decodeURIComponent(invoice[1])) ? json(res, 200, byId(fixtures.invoices, decodeURIComponent(invoice[1]))) : notFound(res)
  // The stub keeps no orders: a status read answers like an order that is not the subscription's pending one.
  if (/^orders\/.+/.test(rest)) return notFound(res)
  return json(res, 501, { code: 'not_implemented', message: 'The stub control plane is read-only' })
}

/** Answers a customer commercial request and returns true; any other path is not this stub's and returns false. */
export function handleCommercial(req, res, url) {
  if (!url.pathname.startsWith('/v1/customer/')) return false
  if (req.method !== 'GET') return json(res, 501, { code: 'not_implemented', message: 'read-only' }), true
  customer(res, url.pathname)
  return true
}
