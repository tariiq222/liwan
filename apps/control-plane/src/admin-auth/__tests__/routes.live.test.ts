import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { adminChallengeResultSchema, adminErrorBodySchema, adminInvitationInfoSchema, adminSessionResultSchema, adminTotpEnrollmentSchema } from '@nasq/commercial-contracts'
import { signServiceRequest } from '@nasq/commercial-contracts/server'
import { migrate, transaction } from '../../db.js'
import { createApp } from '../../http.js'
import { inviteAccount, issueReset } from '../enrollment.js'
import { open, totpBoxAad } from '../crypto.js'
import { createSession, resolveSession } from '../sessions.js'
import { totpAt, totpStep } from '../totp.js'
import { consumeChallenge, finishAuthentication, type WebAuthnLib } from '../webauthn.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^nasq_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback nasq_control_scratch database')
}
const key = 'test-key-'.repeat(8)
const admin = { secretKey: Buffer.alloc(32, 5), rpId: 'localhost', origin: 'http://localhost:3100', rpName: 'Nasq' as const }
const baseConfig = { installationId: 'vendor-scratch', key, inventoryPath: '', repositoryRoot: '/nonexistent', python: 'python3', stateDir: '/nonexistent-state' }
const PASSWORD = 'a long enough password'
const SESSION = /^\d+\.[A-Za-z0-9_-]{43}$/
// Same shapes as @simplewebauthn/server v14.0.3 returns. The credential id comes from the request's response.id.
const lib = {
  generateRegistrationOptions: async () => ({ challenge: 'reg-challenge' }),
  verifyRegistrationResponse: async (o: { response: { id: string } }) => ({ verified: true, registrationInfo: { credential: { id: o.response.id, publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] } } }),
  generateAuthenticationOptions: async () => ({ challenge: 'auth-challenge' }),
  verifyAuthenticationResponse: async (o: { response: { bad?: boolean } }) => o.response.bad ? { verified: false } : { verified: true, authenticationInfo: { newCounter: 1 } },
} as unknown as WebAuthnLib

if (!url) describe.skip('admin auth routes (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin auth routes', () => {
  const pool = new Pool({ connectionString: url })
  let server: ReturnType<ReturnType<typeof createApp>['listen']>
  let bareServer: ReturnType<ReturnType<typeof createApp>['listen']>
  let origin = ''
  let bareOrigin = ''
  const listen = async (app: ReturnType<typeof createApp>) => {
    const s = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => s.once('listening', resolve))
    const address = s.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    return { s, origin: `http://127.0.0.1:${address.port}` }
  }
  beforeAll(async () => {
    await migrate(pool)
    ;({ s: server, origin } = await listen(createApp(pool, { ...baseConfig, admin }, { webauthn: lib })))
    ;({ s: bareServer, origin: bareOrigin } = await listen(createApp(pool, baseConfig, { webauthn: lib })))
  })
  afterAll(async () => {
    for (const s of [server, bareServer]) await new Promise<void>((resolve) => s.close(() => resolve()))
    await pool.end()
  })

  async function post(path: string, body: unknown, extra: Record<string, string> = {}, to = origin) {
    const raw = JSON.stringify(body)
    const headers = signServiceRequest({ method: 'POST', path, body: raw, actor: 'anonymous', anonymous: true, issuer: baseConfig.installationId, key })
    const res = await fetch(to + path, { method: 'POST', headers: { ...headers, ...extra, 'content-type': 'application/json' }, body: raw })
    const text = await res.text()
    return { status: res.status, text, body: text ? JSON.parse(text) : undefined }
  }
  const signed = (session: string) => ({ 'x-nasq-session': session })
  const resolve = (session: string) => transaction(pool, (c) => resolveSession(c, session, new Date()))
  const attempts = async () => (await pool.query('SELECT scope, failures FROM vendor_auth_attempts ORDER BY scope')).rows
  let n = 0
  const credId = () => `cred-${++n}-${Date.now()}`

  // Enrolls an account purely through the public routes.
  async function enrollVia(token: string, accountEmail: string, password = PASSWORD) {
    const options = await post('/v1/admin/auth/enroll/passkey/options', { token })
    expect(options.status).toBe(200)
    const id = credId()
    const verified = await post('/v1/admin/auth/enroll/passkey/verify', { token, challenge_id: options.body.challenge_id, response: { id }, label: 'Laptop' })
    expect(verified.status).toBe(204)
    expect(verified.text).toBe('')
    const totp = await post('/v1/admin/auth/enroll/totp', { token })
    expect(totp.status).toBe(200)
    const secret = open(admin.secretKey, Buffer.from(totp.body.totp_box, 'base64'), totpBoxAad(Number((await pool.query('SELECT id FROM vendor_accounts WHERE email=$1', [accountEmail])).rows[0].id)))
    const complete = await post('/v1/admin/auth/enroll/complete', { token, password, totp_code: totpAt(secret, totpStep(Date.now())), totp_box: totp.body.totp_box })
    return { id, secret, totp, complete, accountEmail }
  }
  let accountId = 0
  let secret: Buffer
  let codes: string[]
  let session: string
  let passkey: string
  const freshCode = async () => { await pool.query('UPDATE vendor_totp SET last_step=0 WHERE account_id=$1', [accountId]); return totpAt(secret, totpStep(Date.now())) }
  const fallback = async (over: Record<string, unknown> = {}, extra: Record<string, string> = {}) => post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: await freshCode(), ...over }, extra)

  beforeEach(async () => {
    await pool.query('TRUNCATE vendor_accounts, vendor_auth_attempts, vendor_auth_challenges, service_nonces, audit_events CASCADE')
    const { token } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'Owner@Nasq.sa', displayName: 'Owner', roles: ['owner'], reason: 'first owner' }, new Date()))
    const done = await enrollVia(token, 'owner@nasq.sa')
    expect(done.complete.status).toBe(200)
    accountId = Number((await pool.query("SELECT id FROM vendor_accounts WHERE email='owner@nasq.sa'")).rows[0].id)
    ;({ secret, passkey } = { secret: done.secret, passkey: done.id })
    codes = done.complete.body.recovery_codes
    session = done.complete.body.session
  })

  it('enrolls through the routes: invitation, passkey, totp, complete', async () => {
    expect(codes).toHaveLength(10)
    const reg = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='auth.passkey_registered'")
    expect(reg.rows).toEqual([{ actor: `account:${accountId}`, subject: `account:${accountId}`, reason: 'enroll' }])
    expect(session).toMatch(SESSION)
    const row = await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])
    expect(row.rows[0].status).toBe('active')
    expect((await resolve(session)).stepUpFresh).toBe(true)
    const { token } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'new@nasq.sa', displayName: 'New', roles: ['support'], reason: 'support' }, new Date()))
    const opened = await post('/v1/admin/auth/invitation', { token })
    expect(opened).toMatchObject({ status: 200, body: { email: 'new@nasq.sa', purpose: 'enroll' } })
    const bad = await post('/v1/admin/auth/invitation', { token: 'A'.repeat(43) })
    expect([bad.status, bad.body]).toEqual([401, { code: 'auth_failed' }])
  })
  it('derives the passkey requirement from the database, not the request', async () => {
    const { token } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'nopass@nasq.sa', displayName: 'N', roles: ['support'], reason: 'support' }, new Date()))
    const totp = await post('/v1/admin/auth/enroll/totp', { token })
    const s = open(admin.secretKey, Buffer.from(totp.body.totp_box, 'base64'), totpBoxAad(Number((await pool.query("SELECT id FROM vendor_accounts WHERE email='nopass@nasq.sa'")).rows[0].id)))
    const body = { token, password: PASSWORD, totp_code: totpAt(s, totpStep(Date.now())), totp_box: totp.body.totp_box }
    const forged = await post('/v1/admin/auth/enroll/complete', { ...body, passkey_registered: true })
    expect([forged.status, forged.body]).toEqual([422, { code: 'invalid' }])
    const missing = await post('/v1/admin/auth/enroll/complete', body)
    expect([missing.status, missing.body]).toEqual([422, { code: 'invalid' }])
  })
  it('signs in with a password and TOTP, and refuses the same TOTP code twice', async () => {
    const code = await freshCode()
    const first = await post('/v1/admin/auth/fallback', { email: 'Owner@Nasq.sa', password: PASSWORD, totp_code: code })
    expect(first.status).toBe(200)
    expect(first.body.session).toMatch(SESSION)
    expect(Object.keys(first.body).sort()).toEqual(['expires_at', 'idle_expires_at', 'session'])
    expect((await resolve(first.body.session)).stepUpFresh).toBe(false)
    const replay = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: code })
    expect(replay.status).toBe(401)
    expect(replay.body).toEqual({ code: 'auth_failed' })
  })
  it('answers identically for unknown email and wrong password', async () => {
    const unknown = await post('/v1/admin/auth/fallback', { email: 'nobody@nasq.sa', password: PASSWORD, totp_code: '123456' })
    const wrong = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: 'not the password', totp_code: '123456' })
    expect([unknown.status, unknown.body]).toEqual([wrong.status, wrong.body])
    expect(wrong.body).toEqual({ code: 'auth_failed' })
  })
  it('keeps counting failures after the 401 and locks after five', async () => {
    for (let i = 0; i < 5; i++) expect((await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: 'wrong wrong wrong', totp_code: '000000' })).status).toBe(401)
    expect(await attempts()).toEqual(expect.arrayContaining([expect.objectContaining({ scope: 'account:owner@nasq.sa', failures: 5 })]))
    const locked = await fallback()
    expect([locked.status, locked.body]).toEqual([429, { code: 'rate_limited' }])
    const events = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='auth.locked'")
    expect(events.rows).toEqual([{ actor: 'anonymous', subject: 'account:owner@nasq.sa', reason: 'lockout' }])
    const failed = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='auth.failed'")
    expect(failed.rows).toEqual(Array(5).fill({ actor: 'anonymous', subject: 'account:owner@nasq.sa', reason: 'fallback' }))
  })
  it('scopes the client address from the signed forwarding header only when well formed', async () => {
    await fallback({ password: 'wrong wrong wrong' }, { 'x-nasq-client-ip': '203.0.113.9' })
    await fallback({ password: 'wrong wrong wrong' }, { 'x-nasq-client-ip': 'evil; DROP' })
    const scopes = (await attempts()).map((r) => r.scope)
    expect(scopes).toContain('ip:203.0.113.9')
    expect(scopes.filter((s) => s.startsWith('ip:') && s !== 'ip:203.0.113.9')).toHaveLength(1)
    expect(scopes.some((s) => s.includes('DROP'))).toBe(false)
  })
  it('counts an IPv6 client by its /64, so rotating the host part does not reset the limit', async () => {
    await fallback({ password: 'wrong wrong wrong' }, { 'x-nasq-client-ip': '2001:db8:0:1::1' })
    await fallback({ password: 'wrong wrong wrong' }, { 'x-nasq-client-ip': '2001:db8:0:1:ffff::9' })
    await fallback({ password: 'wrong wrong wrong' }, { 'x-nasq-client-ip': '2001:db8:0:2::1' })
    const rows = (await attempts()).filter((r) => String(r.scope).startsWith('ip:'))
    expect(rows).toEqual([{ scope: 'ip:2001:db8:0:1::/64', failures: 2 }, { scope: 'ip:2001:db8:0:2::/64', failures: 1 }])
  })
  it('lets exactly one of two parallel sign-ins with the same TOTP code through', async () => {
    const code = await freshCode()
    const results = await Promise.all([0, 1].map(() => post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: code })))
    expect(results.map((r) => r.status).sort()).toEqual([200, 401])
  })
  it('answers 503 admin_unavailable, not a credential verdict, when storage fails', async () => {
    const broken = new Pool({ connectionString: url })
    await broken.end()
    const { s, origin: brokenOrigin } = await listen(createApp(broken, { ...baseConfig, admin }, { webauthn: lib }))
    try {
      const res = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: '123456' }, {}, brokenOrigin)
      expect([res.status, res.body]).toEqual([503, { code: 'admin_unavailable' }])
    } finally { await new Promise<void>((resolve) => s.close(() => resolve())) }
  })
  it('answers in the shapes of the shared contract, strictly', async () => {
    expect(adminSessionResultSchema.parse(await freshCode().then((totp_code) => post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code })).then((r) => r.body))).toBeDefined()
    expect(adminSessionResultSchema.parse({ session, ...(await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[0] })).body })).toBeDefined()
    expect(adminChallengeResultSchema.parse((await post('/v1/admin/auth/passkey/options', {})).body)).toBeDefined()
    const { token } = await transaction(pool, (c) => inviteAccount(c, 'operator', { email: 'shape@nasq.sa', displayName: 'S', roles: ['support'], reason: 'support' }, new Date()))
    expect(adminInvitationInfoSchema.parse((await post('/v1/admin/auth/invitation', { token })).body)).toEqual({ email: 'shape@nasq.sa', purpose: 'enroll' })
    expect(adminTotpEnrollmentSchema.parse((await post('/v1/admin/auth/enroll/totp', { token })).body)).toBeDefined()
    const done = await transaction(pool, (c) => issueReset(c, 'operator', accountId, 'shape', new Date()))
    const enrolled = await enrollVia(done.token, 'owner@nasq.sa', 'a brand new password')
    expect(adminSessionResultSchema.parse(enrolled.complete.body).recovery_codes).toHaveLength(10)
    for (const failed of [await post('/v1/admin/auth/fallback', { email: 'nobody@nasq.sa', password: PASSWORD, totp_code: '123456' }), await post('/v1/admin/auth/fallback', {}), await post('/v1/admin/auth/passkey/options', {}, {}, bareOrigin)]) {
      expect(adminErrorBodySchema.parse(failed.body)).toEqual(failed.body)
    }
  })
  it('uses a recovery code once', async () => {
    const first = await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[0] })
    expect(first.status).toBe(200)
    expect((await resolve(first.body.session)).stepUpFresh).toBe(false)
    const again = await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[0] })
    expect([again.status, again.body]).toEqual([401, { code: 'auth_failed' }])
    expect((await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[1] })).status).toBe(200)
  })
  it('signs in with a passkey (step-up fresh) and burns the challenge', async () => {
    const options = await post('/v1/admin/auth/passkey/options', {})
    expect(options.status).toBe(200)
    expect(options.body.options.challenge).toBe('auth-challenge')
    const ok = await post('/v1/admin/auth/passkey/verify', { challenge_id: options.body.challenge_id, response: { id: passkey } })
    expect(ok.status).toBe(200)
    expect((await resolve(ok.body.session)).stepUpFresh).toBe(true)
    const replay = await post('/v1/admin/auth/passkey/verify', { challenge_id: options.body.challenge_id, response: { id: passkey } })
    expect([replay.status, replay.body]).toEqual([401, { code: 'auth_failed' }])
    const second = await post('/v1/admin/auth/passkey/options', {})
    const bad = await post('/v1/admin/auth/passkey/verify', { challenge_id: second.body.challenge_id, response: { id: passkey, bad: true } })
    expect([bad.status, bad.body]).toEqual([401, { code: 'auth_failed' }])
    expect((await attempts()).some((r) => String(r.scope).startsWith('ip:'))).toBe(true)
    const failed = await pool.query("SELECT subject, reason FROM audit_events WHERE action='auth.failed' AND reason='passkey/verify'")
    expect(failed.rows.length).toBeGreaterThanOrEqual(2)
    expect(failed.rows.every((r) => String(r.subject).startsWith('ip:'))).toBe(true)
  })
  it('lets at most five of twenty parallel wrong sign-ins reach verification, then locks the correct one out', async () => {
    const wrong = () => post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: 'wrong wrong wrong', totp_code: '000000' })
    const results = await Promise.all(Array.from({ length: 20 }, wrong))
    const statuses = results.map((r) => r.status)
    expect(statuses.filter((x) => x === 401).length).toBeLessThanOrEqual(5)
    expect(statuses.filter((x) => x === 429).length).toBeGreaterThanOrEqual(15)
    expect(statuses.every((x) => x === 401 || x === 429)).toBe(true)
    const failed = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='auth.failed'")
    expect(failed.rows[0].n).toBeLessThanOrEqual(5)
    expect(failed.rows[0].n).toBe(statuses.filter((x) => x === 401).length)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='auth.locked'")).rows[0].n).toBe(1)
    const locked = await fallback()
    expect([locked.status, locked.body]).toEqual([429, { code: 'rate_limited' }])
  })
  it('audits a failed step-up verification against the session account', async () => {
    const s = (await fallback()).body.session
    const options = await post('/v1/admin/auth/step-up/options', {}, signed(s))
    const verify = await post('/v1/admin/auth/step-up/verify', { challenge_id: options.body.challenge_id, response: { id: passkey, bad: true } }, signed(s))
    expect([verify.status, verify.body]).toEqual([401, { code: 'auth_failed' }])
    const failed = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='auth.failed'")
    expect(failed.rows).toEqual([{ actor: 'anonymous', subject: `account:${accountId}`, reason: 'step-up' }])
    expect((await resolve(s)).stepUpFresh).toBe(false)
  })
  it('revokes the active sessions of the account when a reset is issued', async () => {
    await resolve(session)
    await transaction(pool, (c) => issueReset(c, 'operator', accountId, 'lost device', new Date()))
    await expect(resolve(session)).rejects.toMatchObject({ code: 'auth_failed' })
  })
  it('steps up a signed-in session with a passkey assertion', async () => {
    const signedIn = await fallback()
    const s = signedIn.body.session
    expect((await resolve(s)).stepUpFresh).toBe(false)
    expect((await post('/v1/admin/auth/step-up/options', {})).status).toBe(401)
    const options = await post('/v1/admin/auth/step-up/options', {}, signed(s))
    expect(options.status).toBe(200)
    const verify = await post('/v1/admin/auth/step-up/verify', { challenge_id: options.body.challenge_id, response: { id: passkey } }, signed(s))
    expect(verify.status).toBe(204)
    expect(verify.text).toBe('')
    expect((await resolve(s)).stepUpFresh).toBe(true)
  })
  it('refuses a step-up challenge of another account', async () => {
    const b = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES('b@nasq.sa','B','active','x') RETURNING id")).rows[0].id)
    await pool.query("INSERT INTO vendor_passkeys(credential_id,account_id,public_key) VALUES('cred-b',$1,'\\x01')", [b])
    const bSession = await transaction(pool, (c) => createSession(c, b, new Date(), false))
    const foreign = await post('/v1/admin/auth/step-up/options', {}, signed(bSession.session))
    expect(foreign.status).toBe(200)
    const a = (await fallback()).body.session
    for (const id of ['cred-b', passkey]) {
      const res = await post('/v1/admin/auth/step-up/verify', { challenge_id: foreign.body.challenge_id, response: { id } }, signed(a))
      expect([res.status, res.body]).toEqual([401, { code: 'auth_failed' }])
      if (id === 'cred-b') { const again = await post('/v1/admin/auth/step-up/options', {}, signed(bSession.session)); foreign.body.challenge_id = again.body.challenge_id }
    }
    expect((await resolve(a)).stepUpFresh).toBe(false)
  })
  it('logs out and revokes the session', async () => {
    const out = await post('/v1/admin/auth/logout', {}, signed(session))
    expect(out.status).toBe(204)
    await expect(resolve(session)).rejects.toMatchObject({ code: 'auth_failed' })
    expect((await post('/v1/admin/auth/logout', {}, signed(session))).status).toBe(401)
  })
  it('rejects unsigned, numeric-actor and replayed requests on auth routes', async () => {
    const path = '/v1/admin/auth/passkey/options'
    const unsigned = await fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(unsigned.status).toBe(401)
    const numeric = signServiceRequest({ method: 'POST', path, body: '{}', actor: 7, issuer: baseConfig.installationId, key })
    const res = await fetch(origin + path, { method: 'POST', headers: { ...numeric, 'content-type': 'application/json' }, body: '{}' })
    expect([res.status, await res.json()]).toEqual([401, { code: 'auth_failed' }])
    const headers = signServiceRequest({ method: 'POST', path, body: '{}', actor: 'anonymous', anonymous: true, issuer: baseConfig.installationId, key, nonce: crypto.randomUUID() })
    const send = () => fetch(origin + path, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(401)
  })
  it('reports admin_unavailable without admin settings, 404 for other methods and 422 for bad bodies', async () => {
    const off = await post('/v1/admin/auth/passkey/options', {}, {}, bareOrigin)
    expect([off.status, off.body]).toEqual([503, { code: 'admin_unavailable' }])
    const get = await fetch(origin + '/v1/admin/auth/fallback')
    expect(get.status).toBe(404)
    const extra = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: '123456', more: 1 })
    expect([extra.status, extra.body]).toEqual([422, { code: 'invalid' }])
    const big = await post('/v1/admin/auth/passkey/verify', { challenge_id: crypto.randomUUID(), response: { id: 'x'.repeat(20000) } })
    expect([big.status, big.body]).toEqual([422, { code: 'invalid' }])
  })
  const passkeyLogin = async (id: string) => {
    const options = await post('/v1/admin/auth/passkey/options', {})
    return post('/v1/admin/auth/passkey/verify', { challenge_id: options.body.challenge_id, response: { id } })
  }
  it('never deadlocks when sign-ins race a reset: each ends as a normal success or refusal', async () => {
    for (let round = 0; round < 12; round++) {
      await pool.query('TRUNCATE vendor_auth_attempts')
      const code = await freshCode()
      const options = await post('/v1/admin/auth/passkey/options', {})
      const [password, passkeySignIn, recoverySignIn, reset] = await Promise.all([
        post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: PASSWORD, totp_code: code }),
        post('/v1/admin/auth/passkey/verify', { challenge_id: options.body.challenge_id, response: { id: passkey } }),
        post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[round % codes.length] }),
        transaction(pool, (c) => issueReset(c, 'operator', accountId, 'race', new Date())),
      ])
      for (const result of [password, passkeySignIn, recoverySignIn]) expect([200, 401]).toContain(result.status)
      const { token } = reset
      const done = await enrollVia(token, 'owner@nasq.sa', PASSWORD)
      expect(done.complete.status).toBe(200)
      ;({ secret, passkey } = { secret: done.secret, passkey: done.id })
      codes = done.complete.body.recovery_codes
    }
  })
  it('takes the account lock before any credential row, so a reset that holds the account cannot deadlock a sign-in half way', async () => {
    // Sign-in side: passkey assertion, then the session insert, with a reset issued while the sign-in is mid-flight.
    const options = await post('/v1/admin/auth/passkey/options', {})
    const consumed = await consumeChallenge(pool, options.body.challenge_id, 'login', new Date())
    const signIn = await pool.connect()
    await signIn.query('BEGIN')
    const outcomes: unknown[] = []
    try {
      await finishAuthentication(signIn, lib, admin, 'login', consumed, { id: passkey }, new Date())
      const reset = transaction(pool, (c) => issueReset(c, 'operator', accountId, 'race', new Date())).then(() => 'reset', (e) => e)
      await new Promise((resolve) => setTimeout(resolve, 300))
      outcomes.push(await createSession(signIn, accountId, new Date(), true).then(() => 'signed-in', (e) => e))
      await signIn.query('COMMIT').catch(() => undefined)
      outcomes.push(await reset)
    } finally { await signIn.query('ROLLBACK').catch(() => undefined); signIn.release() }
    expect(outcomes.filter((o) => o instanceof Error)).toEqual([])
  })
  it('makes every old credential unusable the moment a reset is issued', async () => {
    const { token } = await transaction(pool, (c) => issueReset(c, 'operator', accountId, 'lost device', new Date()))
    const opened = await post('/v1/admin/auth/invitation', { token })
    expect(opened.body.purpose).toBe('reset')
    expect((await pool.query('SELECT status, password_hash FROM vendor_accounts WHERE id=$1', [accountId])).rows[0]).toEqual({ status: 'enrolling', password_hash: null })
    for (const table of ['vendor_passkeys', 'vendor_totp', 'vendor_recovery_codes']) expect((await pool.query(`SELECT 1 FROM ${table} WHERE account_id=$1`, [accountId])).rowCount).toBe(0)
    await expect(resolve(session)).rejects.toMatchObject({ code: 'auth_failed' })
    expect((await fallback()).status).toBe(401)
    await pool.query('TRUNCATE vendor_auth_attempts')
    expect((await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[0] })).status).toBe(401)
    expect((await passkeyLogin(passkey)).status).toBe(401)
  })
  it('refuses every sign-in for a half-finished reset', async () => {
    const { token } = await transaction(pool, (c) => issueReset(c, 'operator', accountId, 'lost device', new Date()))
    const options = await post('/v1/admin/auth/enroll/passkey/options', { token })
    const fresh = credId()
    expect((await post('/v1/admin/auth/enroll/passkey/verify', { token, challenge_id: options.body.challenge_id, response: { id: fresh }, label: 'New' })).status).toBe(204)
    expect((await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])).rows[0].status).toBe('enrolling')
    expect((await passkeyLogin(fresh)).status).toBe(401)
    expect((await fallback()).status).toBe(401)
    expect((await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password: PASSWORD, recovery_code: codes[0] })).status).toBe(401)
    // The same token keeps working to finish the enrolment: nothing was consumed or wiped by the half step.
    const totp = await post('/v1/admin/auth/enroll/totp', { token })
    const secretNow = open(admin.secretKey, Buffer.from(totp.body.totp_box, 'base64'), totpBoxAad(accountId))
    expect((await post('/v1/admin/auth/enroll/complete', { token, password: 'a brand new password', totp_code: totpAt(secretNow, totpStep(Date.now())), totp_box: totp.body.totp_box })).status).toBe(200)
  })
  it('finishes a reset once and keeps the new credentials when the token is replayed', async () => {
    const { token } = await transaction(pool, (c) => issueReset(c, 'operator', accountId, 'lost device', new Date()))
    const done = await enrollVia(token, 'owner@nasq.sa', 'a brand new password')
    expect(done.complete.status).toBe(200)
    const passkeys = await pool.query('SELECT credential_id FROM vendor_passkeys WHERE account_id=$1', [accountId])
    expect(passkeys.rows.map((r) => r.credential_id)).toEqual([done.id])
    expect((await pool.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])).rows[0].status).toBe('active')
    expect((await pool.query('SELECT count(*)::int AS n FROM vendor_accounts')).rows[0].n).toBe(1)
    const issued = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='account.reset_issued'")
    expect(issued.rows).toEqual([{ actor: 'operator', subject: `account:${accountId}`, reason: 'lost device' }])
    const completed = await pool.query("SELECT actor, subject, reason FROM audit_events WHERE action='account.reset_completed'")
    expect(completed.rows).toEqual([{ actor: `account:${accountId}`, subject: `account:${accountId}`, reason: 'reset' }])
    // Replays of the spent token change nothing.
    const reopen = await post('/v1/admin/auth/enroll/passkey/options', { token })
    expect([reopen.status, reopen.body]).toEqual([401, { code: 'auth_failed' }])
    const again = await post('/v1/admin/auth/enroll/passkey/verify', { token, challenge_id: crypto.randomUUID(), response: { id: credId() }, label: 'Replay' })
    expect(again.status).toBe(401)
    const secondTotp = await post('/v1/admin/auth/enroll/totp', { token })
    expect(secondTotp.status).toBe(401)
    expect((await post('/v1/admin/auth/enroll/complete', { token, password: 'another password!!', totp_code: totpAt(done.secret, totpStep(Date.now())), totp_box: done.totp.body.totp_box })).status).toBe(401)
    expect((await pool.query('SELECT credential_id FROM vendor_passkeys WHERE account_id=$1', [accountId])).rows.map((r) => r.credential_id)).toEqual([done.id])
    secret = done.secret
    expect((await fallback({ password: PASSWORD })).status).toBe(401)
    await pool.query('TRUNCATE vendor_auth_attempts')
    expect((await fallback({ password: 'a brand new password' })).status).toBe(200)
  })
})
