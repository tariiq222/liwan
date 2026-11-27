// Stub control plane for the vendor admin BFF, which forwards /api/vendor/v1/<p> to /v1/<p>.
// Read-only fixtures, including the POST quote preview; every other state-changing request answers 501.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const fixtures = JSON.parse(readFileSync(resolve(import.meta.dirname, 'commercial-fixtures.json'), 'utf8'))
// LIWAN_MOCK_SAVED_CARD=1 serves every subscription with the saved card and auto-renew on, to see that state; unset, no card is saved.
const withSavedCard = subscription => (subscription && process.env.LIWAN_MOCK_SAVED_CARD === '1'
  ? { ...subscription, auto_renew: { enabled: true, consent_at: '2026-10-01T08:00:00.000Z', payment_method: fixtures.savedCard } }
  : subscription)
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const notFound = res => json(res, 404, { code: 'not_found', message: 'Not found' })

// The server-built "today" list: the stub derives it from the fixtures, overdue invoices only for billing callers.
function attention(canBill, customerId) {
  const [alpha, beta, gamma] = fixtures.customers.items
  const failed = fixtures.operations.items.find(o => o.status === 'failed')
  const base = { customer_id: null, tenant_id: null, operation_id: null, invoice_id: null, detail: null }
  const all = [
    ...(canBill ? [{ ...base, kind: 'past_due', customer_id: alpha.id, tenant_id: alpha.tenant_id, invoice_id: 'inv-1', name: alpha.name, since: '2026-10-04T00:00:00Z' }] : []),
    { ...base, kind: 'stalled_activation', customer_id: beta.id, tenant_id: beta.tenant_id, name: beta.name, since: '2026-10-14T00:00:00Z', detail: 'applying' },
    { ...base, kind: 'operation_failed', tenant_id: failed.tenant_id, operation_id: failed.id, name: alpha.name, since: '2026-10-15T00:00:00Z', detail: failed.type },
    { ...base, kind: 'setup_required', customer_id: gamma.id, name: gamma.name, since: '2026-10-01T00:00:00Z' },
    { ...base, kind: 'renewal_soon', customer_id: alpha.id, name: alpha.name, since: '2026-10-20T00:00:00Z' },
  ]
  const items = customerId ? all.filter(item => item.customer_id === customerId) : all
  return { items, total: items.length, counts: { subscriptions_active: 2, subscriptions_pending: 1, past_due: 1, stalled: 1, setup_required: 1, renewals: 1 } }
}

function page(collection, url, filter = () => true) {
  const limit = Number(url.searchParams.get('limit') ?? 25) || 25
  const offset = Number(url.searchParams.get('offset') ?? 0) || 0
  const items = collection.items.filter(filter)
  return { items: items.slice(offset, offset + limit), total: collection.items === items ? collection.total : items.length }
}
const q = (url, name) => url.searchParams.get(name) ?? ''
const byId = (collection, id) => collection.items.find(item => item.id === id)

/**
 * The vendor invoice view: the contract invoice plus its adjustments and the server's refund verdict (a paid invoice is the
 * customer's first payment, inside the 14 days). A `change` invoice stands for a later payment: not the first, so the general
 * refund refuses it; it is paid just now so its window is open whenever the spec runs.
 */
const REFUND_WINDOW_DAYS = 14
function vendorInvoice(invoice) {
  if (!invoice) return invoice
  const paid = invoice.status === 'paid' && invoice.paid_at
  const later = invoice.kind === 'change'
  const paidAt = later ? Date.now() : Date.parse(invoice.paid_at)
  const until = paid ? `${new Date(paidAt + REFUND_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)}T23:59:59+03:00` : null
  // An unpaid renewal invoice can be voided unless a customer transfer claim stands in the way (the server's word, never the page's).
  const unpaidRenewal = invoice.kind === 'renewal' && invoice.status === 'issued'
  const claimed = invoice.id === CLAIMED_RENEWAL_INVOICE_ID
  return { ...invoice, adjustments: [], voidable: unpaidRenewal && !claimed, void_block: unpaidRenewal && claimed ? 'transfer_claimed' : null,
    refund: { refundable: Boolean(paid) && !later, first_payment: Boolean(paid) && !later, until, window_days: REFUND_WINDOW_DAYS, locks_subscription: false } }
}
/** Not in the list (the list specs count its rows): unpaid renewal invoices, one voidable and one with a customer transfer claim in the way. */
const RENEWAL_INVOICE_ID = 'inv-renewal'
const CLAIMED_RENEWAL_INVOICE_ID = 'inv-renewal-claimed'
const renewalInvoice = id => ({ ...byId(fixtures.invoices, 'inv-1'), id, kind: 'renewal', order_id: `order-${id}` })
/** Not in the list (the list specs count its rows): a later payment of an AI top-up alone, opened by its link. */
const LATER_TOPUP_INVOICE_ID = 'inv-topup'
const laterTopupInvoice = () => {
  const base = byId(fixtures.invoices, 'inv-2')
  return { ...base, id: LATER_TOPUP_INVOICE_ID, kind: 'change', order_id: 'order-alpha-topup', lines: base.lines.map(line => ({ ...line, key: 'ai_topup', kind: 'ai_topup', description: 'AI top-up' })) }
}

/**
 * Not in the list: a paid first invoice whose vendor-requested automatic refund is stuck, one note per stuck state (the provider's answer
 * not verified, and the money returned but recorded nowhere because another invoice's note holds the payment id).
 */
const STUCK_INVOICE_ID = 'inv-stuck'
const stuckInvoice = () => {
  const base = byId(fixtures.invoices, 'inv-2')
  const note = (id, state, stuck) => ({ id, invoice_id: STUCK_INVOICE_ID, customer_id: base.customer_id, kind: 'credit_note', reason: 'Customer asked for the money back', amount: base.total, status: 'pending', origin: 'vendor',
    created_at: '2026-11-22T05:00:00Z', created_by: 'vendor:1', refund_reference: null, refunded_at: null, refunded_by: null, manual_record_allowed: false, automatic_refund: { state, reason: 'timeout: refund', stuck } })
  const window = { since: '2026-11-22T05:00:00.000Z', attempts: 3, next_attempt_at: '2026-11-22T09:00:00.000Z' }
  return { ...base, id: STUCK_INVOICE_ID, adjustments: [
    note('note-attempted', 'provider_unverified', { ...window, provider_payment_id: null, conflict: null, actions: ['check', 'release'] }),
    note('note-returned', 'refunded_recording', { ...window, provider_payment_id: 'pay_e2e_1', actions: ['check', 'record'],
      conflict: { adjustment_id: 'note-holder', invoice_id: 'inv-1', invoice_number: 'INV-0001', amount: base.total, cause: 'provider_refund', status: 'refunded', refunded_by: 'vendor:9', refunded_at: '2026-11-22T07:00:00.000Z', same_invoice: false } }),
  ] }
}

/** The invoice as its customer prints it: the control plane's document read answers the customer's shape (seller copied at issue, no operator text). */
const SELLER = { legal_name_ar: 'شركة ليوان المحدودة', legal_name_en: 'Liwan Co.', commercial_registration: '1010000000', address: 'طريق العليا\nبرج 4', city: 'الرياض', country: 'السعودية', email: 'billing@liwan.example', phone: '+966110000000' }
const invoiceDocument = id => ({ ...byId(fixtures.invoices, id), seller: SELLER, credit_notes: [] })

/** Workspace name and owning customer, resolved for display the way the control plane does. */
function withTarget(operation) {
  const tenant = fixtures.tenants.items.find(t => t.id === operation.tenant_id)
  const customer = fixtures.customers.items.find(c => c.tenant_id === operation.tenant_id)
  return { ...operation, tenant_name: tenant?.name ?? null, customer_id: customer?.id ?? null }
}

/** An audit event with its actor and subject resolved; the stub knows only workspaces and customers. */
function auditEvent(event) {
  const tenant = fixtures.tenants.items.find(t => t.id === event.subject)
  const customer = fixtures.customers.items.find(c => c.id === event.subject || c.tenant_id === event.subject)
  const kind = tenant ? 'tenant' : customer ? 'customer' : 'other'
  return { ...event, actor_name: null, subject_ref: { kind, name: tenant?.name ?? customer?.name ?? null, customer_id: customer?.id ?? null, tenant_id: tenant?.id ?? null, invoice_id: null } }
}

/** The audit filters of GET /v1/audit; `from`/`to` are inclusive Asia/Riyadh days, `action` an exact action or a family prefix. */
function auditMatches(url) {
  const [text, action, actor, from, to, customer] = ['q', 'action', 'actor', 'from', 'to', 'customer_id'].map(name => q(url, name))
  return event => {
    const resolved = auditEvent(event)
    const day = new Date(Date.parse(event.created_at) + 3 * 3600_000).toISOString().slice(0, 10)
    return (!text || [event.action, event.reason, event.subject, resolved.subject_ref.name ?? ''].some(value => value.includes(text)))
      && (!action || event.action === action || event.action.startsWith(`${action}.`))
      && (!actor || event.actor === actor)
      && (!from || day >= from) && (!to || day <= to)
      && (!customer || resolved.subject_ref.customer_id === customer)
  }
}

/** The invoice list summary: issued totals per currency, scoped by customer but not by status. */
function invoiceSummary(customerId) {
  const issued = fixtures.invoices.items.filter(i => i.status === 'issued' && (!customerId || i.customer_id === customerId))
  const totals = new Map()
  for (const { total } of issued) totals.set(total.currency, { ...total, minor: (totals.get(total.currency)?.minor ?? 0) + total.minor })
  return { outstanding: [...totals.values()] }
}

/** The unified client list the control plane serves: every customer with its workspace, then workspaces without a customer. */
function clientRows() {
  const tenant = id => fixtures.tenants.items.find(t => t.id === id)
  const display = s => (s ? (s.pending_order ? 'awaiting_payment' : s.state === 'active' ? 'active' : 'activating') : null)
  const planName = s => fixtures.plans.items.find(p => p.id === s?.applied?.plan_revision_id)?.name ?? null
  const rows = fixtures.customers.items.map(c => ({
    customer_id: c.id, tenant_id: c.tenant_id, name: c.name, subscription_state: display(c.subscription), plan_name: planName(c.subscription), pending_plan_name: null,
    renewal_at: c.subscription?.renewal_at ?? null, setup_required: Boolean(c.commercial_setup_required),
    tenant_status: tenant(c.tenant_id)?.status ?? null, commercial_mode: tenant(c.tenant_id)?.commercial_mode ?? null, hosting_model: tenant(c.tenant_id)?.hosting_model ?? null,
  }))
  const owned = new Set(fixtures.customers.items.map(c => c.tenant_id))
  for (const t of fixtures.tenants.items) {
    if (!owned.has(t.id)) rows.push({ customer_id: null, tenant_id: t.id, name: t.name, subscription_state: null, plan_name: null, pending_plan_name: null, renewal_at: null, setup_required: false, tenant_status: t.status, commercial_mode: t.commercial_mode, hosting_model: t.hosting_model })
  }
  return rows
}

/** `capabilities` narrows /v1/context to the signed-in account; without it the fixture context is served whole. */
export function handleCommercial(req, res, url, { capabilities } = {}) {
  const path = url.pathname
  // Quote preview is a read operation transported as POST; it never creates an order.
  if (req.method === 'POST' && path === '/v1/commercial/quotes') return json(res, 200, fixtures.quote), true
  if (req.method !== 'GET') return json(res, 501, { code: 'not_implemented', message: 'The stub control plane is read-only' }), true
  const send = body => (body === undefined ? notFound(res) : json(res, 200, body))
  let m
  if (path === '/v1/context') send(capabilities ? { ...fixtures.context, capabilities: fixtures.context.capabilities.filter(name => capabilities.includes(name)) } : fixtures.context)
  else if (path === '/v1/overview') send(fixtures.overview)
  else if (path === '/v1/commercial/attention') send(attention(!capabilities || capabilities.includes('vendor.billing.manage'), url.searchParams.get('customer_id')))
  else if (path === '/v1/catalog') send({ items: fixtures.catalogVersions.items, total: fixtures.catalogVersions.items.length })
  else if (path === '/v1/audit') {
    const events = fixtures.audit.items.filter(auditMatches(url))
    const from = (Math.max(1, Number(q(url, 'page')) || 1) - 1) * 25
    send({ items: events.slice(from, from + 25).map(auditEvent), total: events.length })
  }
  else if (path === '/v1/tenants') send(page(fixtures.tenants, url, t => !q(url, 'q') || t.name.includes(q(url, 'q'))))
  else if ((m = /^\/v1\/tenants\/([^/]+)$/.exec(path))) send(byId(fixtures.tenants, m[1]))
  else if (path === '/v1/operations') {
    const feed = page(fixtures.operations, url, o => !q(url, 'tenant_id') || o.tenant_id === q(url, 'tenant_id'))
    send({ items: feed.items.map(withTarget), total: feed.total })
  }
  else if ((m = /^\/v1\/operations\/([^/]+)$/.exec(path))) send(fixtures.operationDetails[m[1]] && withTarget(fixtures.operationDetails[m[1]]))
  else if (path === '/v1/commercial/clients') {
    const state = q(url, 'state')
    const matches = r => (!q(url, 'q') || r.name.includes(q(url, 'q'))) && (!state || (state === 'setup_required' ? r.setup_required || (r.customer_id && !r.subscription_state) : state === 'no_workspace' ? r.customer_id && !r.tenant_id : state === 'no_commercial' ? !r.customer_id : r.subscription_state === state))
    const items = clientRows().filter(matches)
    const from = (Math.max(1, Number(q(url, 'page')) || 1) - 1) * 25
    send({ items: items.slice(from, from + 25), total: items.length })
  } else if (path === '/v1/commercial/customers') send(page(fixtures.customers, url, c => (!q(url, 'q') || c.name.includes(q(url, 'q'))) && (!q(url, 'tenant_id') || c.tenant_id === q(url, 'tenant_id'))))
  else if ((m = /^\/v1\/commercial\/customers\/([^/]+)$/.exec(path))) send(byId(fixtures.customers, m[1]))
  else if ((m = /^\/v1\/commercial\/subscriptions\/([^/]+)$/.exec(path))) send(withSavedCard(fixtures.subscriptions[m[1]]))
  else if ((m = /^\/v1\/commercial\/subscriptions\/([^/]+)\/(branches|usage)$/.exec(path))) send(fixtures.subscriptionParts[`${m[1]}:${m[2]}`])
  else if (path === '/v1/commercial/invoices') { const listed = page(fixtures.invoices, url, i => (!q(url, 'status') || i.status === q(url, 'status')) && (!q(url, 'customer_id') || i.customer_id === q(url, 'customer_id'))); send({ ...listed, items: listed.items.map(vendorInvoice), summary: invoiceSummary(q(url, 'customer_id')) }) }
  else if ((m = /^\/v1\/commercial\/invoices\/([^/]+)\/document$/.exec(path))) send(invoiceDocument(m[1]))
  else if ((m = /^\/v1\/commercial\/invoices\/([^/]+)$/.exec(path))) send(m[1] === STUCK_INVOICE_ID ? { ...vendorInvoice(stuckInvoice()), adjustments: stuckInvoice().adjustments } : vendorInvoice(m[1] === LATER_TOPUP_INVOICE_ID ? laterTopupInvoice() : [RENEWAL_INVOICE_ID, CLAIMED_RENEWAL_INVOICE_ID].includes(m[1]) ? renewalInvoice(m[1]) : byId(fixtures.invoices, m[1])))
  else if ((m = /^\/v1\/commercial\/orders\/([^/]+)\/payment-attempts$/.exec(path))) send(fixtures.paymentAttempts[decodeURIComponent(m[1])] ?? { items: [], total: 0 })
  else if (path === '/v1/commercial/plans') send(page(fixtures.plans, url, p => (!q(url, 'status') || p.status === q(url, 'status')) && (!q(url, 'q') || p.name.includes(q(url, 'q')))))
  else if ((m = /^\/v1\/commercial\/plans\/([^/]+)$/.exec(path))) send(byId(fixtures.plans, m[1]))
  else if (path === '/v1/commercial/bundles') send(page(fixtures.bundles, url, b => (!q(url, 'status') || b.status === q(url, 'status')) && (!q(url, 'q') || b.name.includes(q(url, 'q')))))
  else if ((m = /^\/v1\/commercial\/bundles\/([^/]+)$/.exec(path))) send(byId(fixtures.bundles, m[1]))
  else if (path === '/v1/commercial/catalog/releases') send({ items: fixtures.releases, total: fixtures.releases.length })
  // The production order: schema_012 inserts both rows in one statement, so they share created_at and the VAT row sorts
  // first. The plan form must still default to the no-tax policy — that is what this fixture exists to exercise.
  else if (path === '/v1/commercial/ai-billing-settings') send({ topup_amounts_minor: [2500, 5000, 10000], topup_minimum_minor: 2500, usd_rate: '3.75', trial_allowance_minor: 500, monthly_allowance_minor: 1000 })
  else if (path === '/v1/commercial/policies') send({ items: [fixtures.policy, fixtures.noTaxPolicy], total: 2 })
  else notFound(res)
  return true
}
