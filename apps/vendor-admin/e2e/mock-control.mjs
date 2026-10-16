// MOCK of the control plane for the vendor admin e2e checks. It is not the real service:
//  - every request signature is verified with the real verifyServiceRequest (anonymous for
//    /v1/admin/auth/*, numeric actor for the rest, a nonce is accepted once), like the real service;
//  - WebAuthn is NOT verified cryptographically: any assertion or attestation naming a registered
//    credential id is accepted. Real verification is covered by the control plane's own tests;
//  - everything else under /v1 (catalog, tenants, commercial, ...) is the read-only fixture stub of
//    commercial-mock-routes.mjs, with /v1/context narrowed to the signed-in account's roles;
//  - TOTP accepts the fixed code in mock-settings.mjs;
//  - the account routes follow apps/control-plane/src/admin-auth/accounts-http.ts (reason 3-1000, active owner
//    only, last_owner and conflict answers, step-up on every mutation) over an in-memory account list.
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createJiti } from 'jiti'
import { handleCommercial } from './commercial-mock-routes.mjs'
import { ADMIN_PASSWORD, INSTALLATION_ID, MOCK_PORT, OWNER_EMAIL, SERVICE_KEY, SUPPORT_EMAIL, TOTP_CODE } from './mock-settings.mjs'

const { verifyServiceRequest } = await createJiti(import.meta.url).import('@webvue/commercial-contracts/server')

const RP_ID = 'localhost'
const FAILURES_BEFORE_LOCK = 5
const b64url = size => randomBytes(size).toString('base64url')
const ROLES = ['owner', 'customer_success', 'finance', 'product', 'operations', 'support']
const STEP_UP_WINDOW = 5 * 60e3
// Mirrors ROLE_CAPABILITIES of apps/control-plane/src/admin-auth/roles.ts.
const ROLE_CAPABILITIES = {
  owner: ['vendor.read', 'vendor.audit.read', 'vendor.tenants.manage', 'vendor.subscriptions.manage', 'vendor.catalog.manage', 'vendor.pricing.manage', 'vendor.billing.manage', 'vendor.operations.run', 'vendor.accounts.manage'],
  customer_success: ['vendor.read', 'vendor.tenants.manage', 'vendor.subscriptions.manage'],
  finance: ['vendor.read', 'vendor.billing.manage'],
  product: ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'],
  operations: ['vendor.read', 'vendor.operations.run'],
  support: ['vendor.read', 'vendor.audit.read'],
}
const capabilitiesOf = roles => [...new Set(roles.flatMap(role => ROLE_CAPABILITIES[role] ?? []))].sort()
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(status === 204 ? undefined : JSON.stringify(body ?? {}))
}

export function createMockControl() {
  let accounts, invitations, sessions, challenges, nonces, failures, config, stats

  function reset() {
    accounts = new Map([[1, { id: 1, email: OWNER_EMAIL, display_name: 'Owner', roles: ['owner'], password: ADMIN_PASSWORD, passkeys: new Set(), recovery: new Set(['abcd-efgh-jkmn']), active: true, disabled: false }],
      [2, { id: 2, email: SUPPORT_EMAIL, display_name: 'Support', roles: ['support'], password: ADMIN_PASSWORD, passkeys: new Set(), recovery: new Set(), active: true, disabled: false }],
    ])
    invitations = new Map()
    sessions = new Map()
    challenges = new Map()
    nonces = new Set()
    failures = new Map()
    config = { unavailable: false, stepUpRequired: false }
    stats = { anonymous: 0, numeric: 0, rejected: 0, lastClientIp: null }
  }
  reset()

  const profile = account => ({ id: account.id, email: account.email, display_name: account.display_name, roles: account.roles, capabilities: capabilitiesOf(account.roles) })
  const accountByEmail = email => [...accounts.values()].find(a => a.email === String(email).trim().toLowerCase())

  function startSession(account, steppedUp) {
    const session = `${account.id}.${b64url(32)}`
    sessions.set(session, { accountId: account.id, steppedUpAt: steppedUp ? Date.now() : 0, seenAt: Date.now() })
    return { session, expires_at: new Date(Date.now() + 12 * 3600e3).toISOString(), idle_expires_at: new Date(Date.now() + 1800e3).toISOString() }
  }

  /** One attempt against a scope counts; the sixth in a row is refused as rate_limited. */
  function attempt(scopes, ok) {
    if (scopes.some(s => (failures.get(s) ?? 0) >= FAILURES_BEFORE_LOCK)) return 'locked'
    for (const s of scopes) failures.set(s, ok ? 0 : (failures.get(s) ?? 0) + 1)
    return ok ? 'ok' : 'failed'
  }
  const refuse = (res, result) => result === 'locked' ? json(res, 429, { code: 'rate_limited' }) : json(res, 401, { code: 'auth_failed' })

  function newChallenge(kind, accountId) {
    const id = randomUUID()
    challenges.set(id, { kind, accountId })
    return id
  }
  const takeChallenge = (id, kind) => {
    const found = challenges.get(id)
    challenges.delete(id)
    return found?.kind === kind ? found : null
  }
  const credentialId = response => (typeof response?.id === 'string' ? response.id : null)
  const sessionOf = req => sessions.get(String(req.headers['x-webvue-session'] ?? ''))
  const invitationOf = token => invitations.get(token)

  const statusOf = account => (account.disabled ? 'disabled' : account.active ? 'active' : 'enrolling')
  const lastSeenAt = (account) => {
    const seen = [...sessions.values()].filter(session => session.accountId === account.id).map(session => session.seenAt)
    return seen.length ? new Date(Math.max(...seen)).toISOString() : null
  }
  const activeOwners = () => [...accounts.values()].filter(account => account.active && !account.disabled && account.roles.includes('owner'))
  const validName = name => typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 120
  const validRoles = roles => Array.isArray(roles) && roles.length >= 1 && roles.every(role => ROLES.includes(role)) && new Set(roles).size === roles.length
  const validReason = reason => typeof reason === 'string' && reason.trim().length >= 3 && reason.trim().length <= 1000
  const revokeSessions = (account) => { for (const [key, session] of sessions) if (session.accountId === account.id) sessions.delete(key) }
  function issueInvitation(accountId) {
    const token = b64url(32)
    for (const [old, invitation] of invitations) if (invitation.accountId === accountId) invitations.delete(old)
    invitations.set(token, { accountId })
    return { invitation_token: token, expires_at: new Date(Date.now() + 24 * 3600e3).toISOString() }
  }
  /** The signed-in active owner behind the request, or null after the refusal has been written (401, step-up, 403). */
  function ownerSession(req, res, mutating = false) {
    const session = sessionOf(req)
    if (!session) return void json(res, 401, { code: 'unauthorized' })
    if (mutating && config.stepUpRequired && Date.now() - session.steppedUpAt > STEP_UP_WINDOW) return void json(res, 403, { code: 'step_up_required' })
    const actor = accounts.get(session.accountId)
    if (!activeOwners().includes(actor)) return void json(res, 403, { code: 'forbidden' })
    return actor
  }

  const authRoutes = {
    '/v1/admin/auth/invitation': ({ body }, res) => {
      const inv = invitationOf(body.token)
      return inv ? json(res, 200, { email: accounts.get(inv.accountId).email, purpose: 'enroll' }) : json(res, 401, { code: 'auth_failed' })
    },
    '/v1/admin/auth/enroll/passkey/options': ({ body }, res) => {
      const inv = invitationOf(body.token)
      if (!inv) return json(res, 401, { code: 'auth_failed' })
      const account = accounts.get(inv.accountId)
      return json(res, 200, {
        challenge_id: newChallenge('register', account.id),
        options: {
          rp: { name: 'WebVue', id: RP_ID }, user: { id: b64url(16), name: account.email, displayName: account.display_name },
          challenge: b64url(32), pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60000, attestation: 'none',
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        },
      })
    },
    '/v1/admin/auth/enroll/passkey/verify': ({ body }, res) => {
      const inv = invitationOf(body.token)
      const challenge = takeChallenge(body.challenge_id, 'register')
      const id = credentialId(body.response)
      if (!inv || !challenge || !id || typeof body.response?.response?.attestationObject !== 'string') return json(res, 401, { code: 'auth_failed' })
      accounts.get(inv.accountId).passkeys.add(id)
      inv.passkey = true
      return json(res, 204)
    },
    '/v1/admin/auth/enroll/totp': ({ body }, res) => {
      const inv = invitationOf(body.token)
      if (!inv) return json(res, 401, { code: 'auth_failed' })
      const email = accounts.get(inv.accountId).email
      return json(res, 200, { totp_uri: `otpauth://totp/${encodeURIComponent(`WebVue:${email}`)}?secret=JBSWY3DPEHPK3PXP&issuer=WebVue&algorithm=SHA1&digits=6&period=30`, totp_box: Buffer.from('mock-box').toString('base64') })
    },
    '/v1/admin/auth/enroll/complete': ({ body }, res) => {
      const inv = invitationOf(body.token)
      if (!inv) return json(res, 401, { code: 'auth_failed' })
      if (!inv.passkey || body.password.length < 12 || body.totp_code !== TOTP_CODE) return json(res, 422, { code: 'invalid' })
      const account = accounts.get(inv.accountId)
      Object.assign(account, { password: body.password, active: true })
      account.recovery = new Set(Array.from({ length: 10 }, (_, i) => `mock-${String(i).padStart(2, '0')}-${b64url(3).slice(0, 4).toLowerCase()}`.slice(0, 14).padEnd(14, 'x')))
      invitations.delete(body.token)
      return json(res, 200, { recovery_codes: [...account.recovery], ...startSession(account, true) })
    },
    '/v1/admin/auth/passkey/options': (_ctx, res) => json(res, 200, {
      challenge_id: newChallenge('login', null),
      options: { challenge: b64url(32), rpId: RP_ID, timeout: 60000, userVerification: 'required' },
    }),
    '/v1/admin/auth/passkey/verify': ({ body, ip }, res) => {
      const scope = `ip:${ip}`
      const challenge = takeChallenge(body.challenge_id, 'login')
      const id = credentialId(body.response)
      const owner = [...accounts.values()].find(a => a.passkeys.has(id) && !a.disabled)
      const result = attempt([scope], Boolean(challenge && owner))
      return result === 'ok' ? json(res, 200, startSession(owner, true)) : refuse(res, result)
    },
    '/v1/admin/auth/fallback': ({ body, ip }, res) => {
      const account = accountByEmail(body.email)
      const result = attempt([`account:${String(body.email).trim().toLowerCase()}`, `ip:${ip}`], Boolean(account?.active && !account.disabled && account.password === body.password && body.totp_code === TOTP_CODE))
      return result === 'ok' ? json(res, 200, startSession(account, false)) : refuse(res, result)
    },
    '/v1/admin/auth/recovery': ({ body, ip }, res) => {
      const account = accountByEmail(body.email)
      const valid = Boolean(account?.active && !account.disabled && account.password === body.password && account.recovery.has(body.recovery_code.trim().toLowerCase()))
      const result = attempt([`account:${String(body.email).trim().toLowerCase()}`, `ip:${ip}`], valid)
      if (result !== 'ok') return refuse(res, result)
      account.recovery.delete(body.recovery_code.trim().toLowerCase())
      return json(res, 200, startSession(account, false))
    },
    '/v1/admin/auth/step-up/options': ({ req }, res) => {
      const session = sessionOf(req)
      if (!session) return json(res, 401, { code: 'auth_failed' })
      return json(res, 200, {
        challenge_id: newChallenge('step_up', session.accountId),
        options: { challenge: b64url(32), rpId: RP_ID, timeout: 60000, userVerification: 'required', allowCredentials: [...accounts.get(session.accountId).passkeys].map(id => ({ id, type: 'public-key' })) },
      })
    },
    '/v1/admin/auth/step-up/verify': ({ req, body }, res) => {
      const session = sessionOf(req)
      if (!session) return json(res, 401, { code: 'auth_failed' })
      const challenge = takeChallenge(body.challenge_id, 'step_up')
      if (config.stepUpVerifyFails || !challenge || !accounts.get(session.accountId).passkeys.has(credentialId(body.response))) return json(res, 401, { code: 'auth_failed' })
      session.steppedUpAt = Date.now()
      return json(res, 204)
    },
    '/v1/admin/auth/logout': ({ req }, res) => {
      const key = String(req.headers['x-webvue-session'] ?? '')
      if (!sessions.delete(key)) return json(res, 401, { code: 'auth_failed' })
      return json(res, 204)
    },
  }

  const apiRoutes = {
    'GET /v1/admin/me': ({ req }, res) => {
      const session = sessionOf(req)
      return session ? json(res, 200, profile(accounts.get(session.accountId))) : json(res, 401, { code: 'unauthorized' })
    },
    'GET /v1/admin/accounts': ({ req }, res) => {
      const actor = ownerSession(req, res)
      if (!actor) return
      const items = [...accounts.values()].map(account => ({
        id: account.id, email: account.email, display_name: account.display_name, status: statusOf(account), roles: [...account.roles].sort(),
        passkeys: account.passkeys.size, last_seen_at: lastSeenAt(account),
      }))
      return json(res, 200, { items, total: items.length })
    },
    'POST /v1/admin/accounts': ({ req, body }, res) => {
      const actor = ownerSession(req, res, true)
      if (!actor) return
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+$/.test(email) || !validName(body.display_name) || !validRoles(body.roles) || !validReason(body.reason)) return json(res, 422, { code: 'invalid' })
      if (accountByEmail(email)) return json(res, 409, { code: 'conflict' })
      const id = Math.max(...accounts.keys()) + 1
      accounts.set(id, { id, email, display_name: body.display_name.trim(), roles: [...body.roles], password: null, passkeys: new Set(), recovery: new Set(), active: false, disabled: false })
      return json(res, 201, { id, ...issueInvitation(id) })
    },
  }

  /** /v1/admin/accounts/:id/(roles|disable|reset), matched by pattern because the id is part of the path. */
  const ACCOUNT_ACTION = /^\/v1\/admin\/accounts\/([1-9][0-9]{0,15})\/(roles|disable|reset)$/
  const accountActions = {
    roles: (target, actor, body, res) => {
      if (!validRoles(body.roles) || !validReason(body.reason) || !target || target.disabled) return json(res, 422, { code: 'invalid' })
      const owners = activeOwners()
      const soleOwner = owners.length <= 1 && owners.includes(target)
      const selfDemotion = actor === target && !owners.some(owner => owner !== target)
      if ((soleOwner && !body.roles.includes('owner')) || (selfDemotion && !body.roles.includes('owner'))) return json(res, 409, { code: 'last_owner' })
      target.roles = [...body.roles]
      return json(res, 204)
    },
    disable: (target, _actor, body, res) => {
      if (!validReason(body.reason) || !target || target.disabled) return json(res, 422, { code: 'invalid' })
      if (activeOwners().length <= 1 && activeOwners().includes(target)) return json(res, 409, { code: 'last_owner' })
      Object.assign(target, { disabled: true, active: false })
      revokeSessions(target)
      for (const [token, invitation] of invitations) if (invitation.accountId === target.id) invitations.delete(token)
      return json(res, 204)
    },
    reset: (target, _actor, body, res) => {
      if (!validReason(body.reason) || !target || target.disabled) return json(res, 422, { code: 'invalid' })
      revokeSessions(target)
      return json(res, 200, issueInvitation(target.id))
    },
  }

  // Test controls (not signed, loopback only): reset state, mint an invitation, toggle modes, read the counters.
  const controls = {
    'POST /__mock/reset': (_ctx, res) => { reset(); json(res, 204) },
    'POST /__mock/config': ({ body }, res) => { Object.assign(config, body); json(res, 200, config) },
    'POST /__mock/invitations': ({ body }, res) => {
      const id = Math.max(...accounts.keys()) + 1
      const token = b64url(32)
      accounts.set(id, { id, email: `invitee${id}@example.test`, display_name: `Invitee ${id}`, roles: body.roles ?? ['support'], password: null, passkeys: new Set(), recovery: new Set(), active: false, disabled: false })
      invitations.set(token, { accountId: id })
      json(res, 200, { token, email: `invitee${id}@example.test` })
    },
    'POST /__mock/age-step-up': (_ctx, res) => { for (const session of sessions.values()) session.steppedUpAt = 0; json(res, 204) },
    'GET /__mock/stats': (_ctx, res) => json(res, 200, { ...stats, sessions: sessions.size }),
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch { return json(res, 422, { code: 'invalid' }) }
    const route = `${req.method} ${url.pathname}`
    const control = controls[route]
    if (control) return control({ body }, res)

    const isAuth = url.pathname.startsWith('/v1/admin/auth/')
    if (isAuth && config.unavailable) return json(res, 503, { code: 'admin_unavailable' })
    const path = `${url.pathname}${url.search}`
    const signed = verifyServiceRequest({ method: req.method, path, body: raw, key: SERVICE_KEY, headers: req.headers, anonymous: isAuth })
    const session = String(req.headers['x-webvue-session'] ?? '')
    const consistent = isAuth || (signed && session.split('.')[0] === String(signed.actor))
    if (!signed || signed.issuer !== INSTALLATION_ID || !consistent || nonces.has(signed.nonce)) {
      stats.rejected += 1
      return json(res, 401, { code: isAuth ? 'auth_failed' : 'unauthorized' })
    }
    nonces.add(signed.nonce)
    stats[isAuth ? 'anonymous' : 'numeric'] += 1
    stats.lastClientIp = req.headers['x-webvue-client-ip'] ?? null
    if (isAuth && req.method !== 'POST') return json(res, 404, { code: 'not_found' })
    const action = req.method === 'POST' ? ACCOUNT_ACTION.exec(url.pathname) : null
    if (action) {
      const actor = ownerSession(req, res, true)
      return actor ? accountActions[action[2]](accounts.get(Number(action[1])), actor, body, res) : undefined
    }
    const handler = isAuth ? authRoutes[url.pathname] : apiRoutes[route]
    if (!handler && !isAuth) {
      const account = accounts.get(sessionOf(req)?.accountId)
      if (!account) return json(res, 401, { code: 'unauthorized' })
      return void handleCommercial(req, res, url, { capabilities: capabilitiesOf(account.roles) })
    }
    if (!handler) return json(res, 404, { code: 'not_found' })
    return handler({ req, body, ip: String(req.headers['x-webvue-client-ip'] ?? 'unknown') }, res)
  }

  return createServer((req, res) => { handle(req, res).catch(() => json(res, 500, { code: 'mock_error' })) })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createMockControl().listen(MOCK_PORT, '127.0.0.1', () => console.log(`mock control service on ${MOCK_PORT}`))
}
