// Part of the Plan 6e mock stack. A stub control plane for the customer BFF: /api/commercial/v1/<p> is
// forwarded to /v1/customer/<p>. Read-only fixtures; state-changing requests answer 501, except opening a card form session
// for the one payable order (below), so the pay page can be opened.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'commercial-fixtures.json'), 'utf8'))
// LIWAN_MOCK_SAVED_CARD=1 serves every subscription with the saved card and auto-renew on, to see that state; unset, no card is saved.
const withSavedCard = subscription => (subscription && process.env.LIWAN_MOCK_SAVED_CARD === '1'
  ? { ...subscription, auto_renew: { enabled: true, consent_at: '2026-10-01T08:00:00.000Z', payment_method: fixtures.savedCard } }
  : subscription)
// The pay page against this stack: LIWAN_MOCK_PAY picks what opening the card form answers. Unset serves a session whose
// publishable key is the stand-in key, which the page renders as a labelled stand-in (the provider is never called).
//   in_progress -> 409 payment_in_progress, unavailable -> 409 card_form_unavailable, expired -> a session that already ended,
//   not_allowed -> 409 auto_renew_not_allowed when the customer asked to save the card.
const PAY_OUTCOME = process.env.LIWAN_MOCK_PAY
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const notFound = res => json(res, 404, { code: 'not_found', message: 'Not found' })
const byId = (collection, id) => collection.items.find(item => item.id === id)

function customer(res, path) {
  const rest = path.replace('/v1/customer/', '')
  if (rest === 'subscription') return json(res, 200, withSavedCard(fixtures.subscription))
  if (rest === 'catalog') return json(res, 200, fixtures.catalog)
  if (rest === 'usage') return json(res, 200, fixtures.usage)
  if (rest === 'branches') return json(res, 200, fixtures.branches)
  if (rest === 'invoices') return json(res, 200, { items: fixtures.invoices.items, total: fixtures.invoices.total })
  const invoice = /^invoices\/(.+)$/.exec(rest)
  if (invoice) return byId(fixtures.invoices, decodeURIComponent(invoice[1])) ? json(res, 200, byId(fixtures.invoices, decodeURIComponent(invoice[1]))) : notFound(res)
  // The stub keeps one payable order for the pay page; any other order answers like one that is not the customer's.
  const order = /^orders\/([^/]+)$/.exec(rest)
  if (order) return decodeURIComponent(order[1]) === fixtures.payOrder.id ? json(res, 200, fixtures.payOrder) : notFound(res)
  return json(res, 501, { code: 'not_implemented', message: 'The stub control plane is read-only' })
}

function openFormSession(res, saveCard) {
  if (PAY_OUTCOME === 'in_progress') return json(res, 409, { code: 'payment_in_progress', message: 'A payment is in progress' })
  if (PAY_OUTCOME === 'unavailable') return json(res, 409, { code: 'card_form_unavailable', message: 'The card form is unavailable' })
  if (PAY_OUTCOME === 'not_allowed' && saveCard) return json(res, 409, { code: 'auto_renew_not_allowed', message: 'The plan does not allow automatic renewal' })
  return json(res, 201, PAY_OUTCOME === 'expired' ? { ...fixtures.payFormSession, expires_at: '2020-01-01T00:00:00.000Z' } : fixtures.payFormSession)
}

/** Answers a customer commercial request and returns true; any other path is not this stub's and returns false. */
export function handleCommercial(req, res, url) {
  if (!url.pathname.startsWith('/v1/customer/')) return false
  const attempt = /^\/v1\/customer\/orders\/([^/]+)\/payment-attempts$/.exec(url.pathname)
  if (req.method === 'POST' && attempt && decodeURIComponent(attempt[1]) === fixtures.payOrder.id) {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => { try { openFormSession(res, JSON.parse(raw || '{}').save_card === true) } catch { json(res, 422, { code: 'invalid', message: 'Invalid JSON' }) } })
    return true
  }
  if (req.method !== 'GET') return json(res, 501, { code: 'not_implemented', message: 'read-only' }), true
  customer(res, url.pathname)
  return true
}
