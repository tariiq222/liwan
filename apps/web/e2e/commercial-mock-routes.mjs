// Part of the Plan 6e mock stack. A stub control plane for the two Nuxt BFFs: the vendor BFF forwards
// /api/vendor/v1/<p> to /v1/<p>, the customer BFF /api/commercial/v1/<p> to /v1/customer/<p>.
// Read-only fixtures, including the POST quote preview; state-changing requests answer 501.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'commercial-fixtures.json'), 'utf8'))
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const notFound = res => json(res, 404, { code: 'not_found', message: 'Not found' })

function page(collection, url, filter = () => true) {
  const limit = Number(url.searchParams.get('limit') ?? 25) || 25
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0
  const items = collection.items.filter(filter)
  return { items: items.slice(offset, offset + limit), total: collection.items === items ? collection.total : items.length }
}
const q = (url, name) => url.searchParams.get(name) ?? ''
const byId = (collection, id) => collection.items.find(item => item.id === id)

function customer(res, url, path) {
  const rest = path.replace('/v1/customer/', '')
  if (rest === 'subscription') return json(res, 200, fixtures.customer.subscription)
  if (rest === 'catalog') return json(res, 200, fixtures.customer.catalog)
  if (rest === 'usage') return json(res, 200, fixtures.customer.usage)
  if (rest === 'branches') return json(res, 200, fixtures.customer.branches)
  if (rest === 'invoices') return json(res, 200, { items: fixtures.customer.invoices.items, total: fixtures.customer.invoices.total })
  const invoice = /^invoices\/(.+)$/.exec(rest)
  if (invoice) return byId(fixtures.customer.invoices, decodeURIComponent(invoice[1])) ? json(res, 200, byId(fixtures.customer.invoices, decodeURIComponent(invoice[1]))) : notFound(res)
  return json(res, 501, { code: 'not_implemented', message: 'The stub control plane is read-only' })
}

export function handleCommercial(req, res, url) {
  const path = url.pathname
  if (path.startsWith('/v1/customer/')) { if (req.method !== 'GET') return json(res, 501, { code: 'not_implemented', message: 'read-only' }), true; return customer(res, url, path), true }
  // Quote preview is a read operation transported as POST; it never creates an order.
  if (req.method === 'POST' && path === '/v1/commercial/quotes') return json(res, 200, fixtures.quote), true
  if (req.method !== 'GET') return json(res, 501, { code: 'not_implemented', message: 'The stub control plane is read-only' }), true
  const send = body => (body === undefined ? notFound(res) : json(res, 200, body))
  let m
  if (path === '/v1/context') send(fixtures.context)
  else if (path === '/v1/overview') send(fixtures.overview)
  else if (path === '/v1/catalog') send(fixtures.catalogVersions)
  else if (path === '/v1/packages') send({ items: fixtures.catalog.items, total: fixtures.catalog.total })
  else if ((m = /^\/v1\/packages\/([^/]+)$/.exec(path))) send(byId(fixtures.catalog, decodeURIComponent(m[1])))
  else if (path === '/v1/audit') send({ items: fixtures.audit.items.slice((Math.max(1, Number(q(url, 'page')) || 1) - 1) * 25).slice(0, 25), total: fixtures.audit.total })
  else if (path === '/v1/tenants') send(page(fixtures.tenants, url, t => !q(url, 'q') || t.name.includes(q(url, 'q'))))
  else if ((m = /^\/v1\/tenants\/([^/]+)$/.exec(path))) send(byId(fixtures.tenants, m[1]))
  else if (path === '/v1/operations') send(page(fixtures.operations, url, o => !q(url, 'tenant_id') || o.tenant_id === q(url, 'tenant_id')))
  else if ((m = /^\/v1\/operations\/([^/]+)$/.exec(path))) send(fixtures.operationDetails[m[1]])
  else if (path === '/v1/commercial/customers') send(page(fixtures.customers, url, c => (!q(url, 'q') || c.name.includes(q(url, 'q'))) && (!q(url, 'tenant_id') || c.tenant_id === q(url, 'tenant_id'))))
  else if ((m = /^\/v1\/commercial\/customers\/([^/]+)$/.exec(path))) send(byId(fixtures.customers, m[1]))
  else if ((m = /^\/v1\/commercial\/subscriptions\/([^/]+)$/.exec(path))) send(fixtures.subscriptions[m[1]])
  else if ((m = /^\/v1\/commercial\/subscriptions\/([^/]+)\/(branches|usage)$/.exec(path))) send(fixtures.subscriptionParts[`${m[1]}:${m[2]}`])
  else if (path === '/v1/commercial/invoices') send(page(fixtures.invoices, url, i => (!q(url, 'status') || i.status === q(url, 'status')) && (!q(url, 'customer_id') || i.customer_id === q(url, 'customer_id'))))
  else if ((m = /^\/v1\/commercial\/invoices\/([^/]+)$/.exec(path))) send(byId(fixtures.invoices, m[1]))
  else if ((m = /^\/v1\/commercial\/orders\/([^/]+)\/payment-attempts$/.exec(path))) send(fixtures.paymentAttempts[decodeURIComponent(m[1])] ?? { items: [], total: 0 })
  else if (path === '/v1/commercial/plans') send(page(fixtures.plans, url, p => (!q(url, 'status') || p.status === q(url, 'status')) && (!q(url, 'q') || p.name.includes(q(url, 'q')))))
  else if ((m = /^\/v1\/commercial\/plans\/([^/]+)$/.exec(path))) send(byId(fixtures.plans, m[1]))
  else if (path === '/v1/commercial/bundles') send(page(fixtures.bundles, url, b => (!q(url, 'status') || b.status === q(url, 'status')) && (!q(url, 'q') || b.name.includes(q(url, 'q')))))
  else if ((m = /^\/v1\/commercial\/bundles\/([^/]+)$/.exec(path))) send(byId(fixtures.bundles, m[1]))
  else if (path === '/v1/commercial/catalog/releases') send({ items: fixtures.releases, total: fixtures.releases.length })
  else if (path === '/v1/commercial/policies') send({ items: [fixtures.policy], total: 1 })
  else notFound(res)
  return true
}
