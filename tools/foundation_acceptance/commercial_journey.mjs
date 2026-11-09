import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { cookieHeader, waitFor } from './lib.mjs'

const reason = 'Isolated commercial acceptance'
const cadence = { unit: 'month', count: 1 }
const amount = minor => ({ currency: 'SAR', exponent: 2, minor })
const aiLimits = {
  'ai.messages.monthly': 500,
  'ai.tokens.monthly': 2500000,
  'ai.assist.monthly': 100,
  'ai.tool_calls.per_run': 8,
  'ai.output_tokens.per_run': 2000,
}
const requireStatus = (response, status, description) => {
  assert.equal(response.status, status, `${description} (${response.body?.code ?? 'no_code'})`)
  return response.body
}

export async function commercialJourney({ send, stepUp, version, readOrder, edge, controlOrigin, mailOrigin, record }) {
  const request = (path, body) => send(`/v1/commercial${path}`, { body })
  await stepUp()
  const release = requireStatus(await request('/catalog/releases', { catalog_version: version, reason }), 201, 'catalog release')
  await stepUp()
  const bundles = requireStatus(await request(`/catalog/releases/${release.id}/default-bundles`, { reason }), 200, 'seed bundles')
  assert.ok(bundles.bundles.length, 'sellable bundle expected')
  await stepUp()
  const draft = requireStatus(await request('/plans', {
    name: 'Acceptance paid plan', audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence, amount: amount(9900) }], platform_limits: aiLimits,
    included_bundle_revision_ids: [], optional_bundle_revision_ids: bundles.bundles,
    included_extra_branches: 1, extra_branch_prices: [{ cadence, amount: amount(0) }],
    extra_branches_limit: null, included_users: 3, included_storage_mb: 20480,
    storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
    user_prices: [{ cadence, amount: amount(2900) }], storage_prices: [{ cadence, amount: amount(100) }],
    policy_revision_id: '6f1c3d8e-0000-4000-8000-000000000002',
    trial_days: 14, grace_days: 0, auto_suspend: true, auto_renew_allowed: true,
  }), 201, 'plan draft')
  await stepUp()
  const validated = requireStatus(await request(`/plans/${draft.id}/validate`, { edit_revision: draft.edit_revision, reason }), 200, 'validate plan')
  await stepUp()
  const plan = requireStatus(await request(`/plans/${draft.id}/publish`, { edit_revision: validated.edit_revision, reason }), 200, 'publish plan')

  const login = 'commercial-admin@foundation.test'
  const company = 'Commercial acceptance company'
  const customer = requireStatus(await request('/customers', { name: company, admin_name: 'Commercial acceptance admin', admin_login: login, request_id: randomUUID() }), 201, 'create vendor customer')
  assert.equal(customer.tenant_id, null)
  await stepUp()
  const quote = requireStatus(await request('/customer-quotes', {
    customer_id: customer.id, kind: 'new', plan_revision_id: plan.id,
    bundle_revision_ids: bundles.bundles.slice(0, 1), cadence,
    requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 20480,
  }), 201, 'first paid quote')
  assert.ok(quote.due_now.minor > 0)
  const orderRequest = { quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID() }
  await stepUp()
  const { order } = requireStatus(await request('/orders', orderRequest), 201, 'first paid order')
  assert.equal(order.payment_state, 'awaiting_payment')
  assert.equal(requireStatus(await request('/orders', orderRequest), 200, 'order replay').order.id, order.id)
  const attempt = requireStatus(await request(`/orders/${order.id}/payment-attempts`, { idempotency_key: randomUUID() }), 201, 'simulation attempt')
  const settlement = requireStatus(await request(`/payment-simulator/${attempt.id}/settle`, { outcome: 'succeeded' }), 200, 'simulate provider success')
  record('vendor order was settled through the simulator', settlement.simulated === true && settlement.outcome === 'accepted')

  let active
  await waitFor(async () => {
    active = await readOrder(order.id)
    assert.ok(!['failed', 'needs_intervention'].includes(active?.fulfillment_state), 'commercial worker failed')
    return active?.payment_state === 'paid' && active.fulfillment_state === 'applied' && active.host &&
      active.state === 'active' && active.applied_revision_id === order.target_revision_id
  }, 'commercial payment, provisioning, and activation', 30 * 60_000)
  record('real shared worker activated the paid subscription and published its tenant', true)

  let mail
  await waitFor(async () => {
    const response = await fetch(new URL('/api/v1/messages', mailOrigin), { signal: AbortSignal.timeout(3000) })
    assert.equal(response.status, 200)
    mail = (await response.json()).messages.find(message => message.Subject.includes('Invitation to join') && message.To.some(to => to.Address === login))
    return Boolean(mail)
  }, 'first administrator invitation')
  const message = await fetch(new URL(`/api/v1/message/${mail.ID}`, mailOrigin), { signal: AbortSignal.timeout(3000) })
  assert.equal(message.status, 200)
  const invitationLink = (await message.json()).Text.match(/https:\/\/[^\s<>]+\/invite\/accept\?token=[A-Za-z0-9_-]+/u)?.[0]
  assert.ok(invitationLink, 'captured invitation contains an acceptance link')
  const url = new URL(invitationLink)
  assert.equal(url.origin, `https://${active.host}`)
  const token = url.searchParams.get('token')
  assert.ok(token)
  record('SMTP capture received the real invitation to the new tenant', true)

  const password = `Acceptance-${randomBytes(24).toString('hex')}`
  const accept = () => fetch(new URL('/v1/invitations/accept', controlOrigin), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }),
    signal: AbortSignal.timeout(230000),
  })
  assert.equal((await accept()).status, 200, 'accept invitation via the public control endpoint')
  assert.equal((await accept()).status, 400, 'invitation replay must be refused')
  const signedIn = await edge(active.host, '/api/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) })
  assert.equal(signedIn.status, 200)
  const preSession = cookieHeader(signedIn.headers['set-cookie'])
  assert.equal(JSON.parse(signedIn.text).mfa, 'code', 'password must leave a second step pending')
  const sent = await edge(active.host, '/api/auth/code', { method: 'POST', cookie: preSession, body: JSON.stringify({ channel: 'email' }) })
  assert.equal(sent.status, 200, 'send the sign-in code')
  let code
  await waitFor(async () => {
    const response = await fetch(new URL('/api/v1/messages', mailOrigin), { signal: AbortSignal.timeout(3000) })
    assert.equal(response.status, 200)
    const newest = (await response.json()).messages.find(item => item.Subject.includes('LiwanOS sign-in code') && item.To.some(to => to.Address === login))
    if (!newest) return false
    const result = await fetch(new URL(`/api/v1/message/${newest.ID}`, mailOrigin), { signal: AbortSignal.timeout(3000) })
    assert.equal(result.status, 200)
    code = (await result.json()).Text.match(/sign-in code: (\d{6})/u)?.[1]
    return Boolean(code)
  }, 'first administrator email verification')
  const verified = await edge(active.host, '/api/auth/verify', { method: 'POST', cookie: preSession, body: JSON.stringify({ code }) })
  assert.equal(verified.status, 200, 'verify the first administrator email code')
  const cookie = cookieHeader([...signedIn.headers['set-cookie'], ...verified.headers['set-cookie']])
  const me = await edge(active.host, '/api/v1/me', { cookie })
  assert.equal(me.status, 200)
  const identity = JSON.parse(me.text)
  record('the invited first administrator signed into their own tenant through the TLS edge', identity.login === login && identity.company?.name === company)
  return { id: active.tenant_id, host: active.host, database: active.database_name, filestore: active.filestore, order: order.id }
}
