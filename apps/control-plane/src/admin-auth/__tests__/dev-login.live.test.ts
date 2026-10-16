import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { adminErrorBodySchema, adminSessionResultSchema } from '@webvue/commercial-contracts'
import { signServiceRequest } from '@webvue/commercial-contracts/server'
import { migrate, transaction } from '../../db.js'
import { createApp } from '../../http.js'
import { assertLoopbackDatabase, ensureDevOwner } from '../dev-owner.js'
import { createSession, resolveSession } from '../sessions.js'
import { verifyPassword } from '../passwords.js'
import type { WebAuthnLib } from '../webauthn.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^webvue_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback webvue_control_scratch database')
}
const key = 'test-key-'.repeat(8)
const DEV_EMAIL = 'dev@webvue.sa'
const admin = { secretKey: Buffer.alloc(32, 5), rpId: 'localhost', origin: 'http://localhost:3100', rpName: 'WebVue' as const }
const baseConfig = { installationId: 'vendor-scratch', key, inventoryPath: '', repositoryRoot: '/nonexistent', python: 'python3', stateDir: '/nonexistent-state' }
const lib = {} as unknown as WebAuthnLib

if (!url) describe.skip('admin dev login (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin dev login', () => {
  const pool = new Pool({ connectionString: url })
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = []
  let devOrigin = ''
  let plainOrigin = ''
  const listen = async (config: Parameters<typeof createApp>[1]) => {
    const s = createApp(pool, config, { webauthn: lib }).listen(0, '127.0.0.1')
    servers.push(s)
    await new Promise<void>((resolve) => s.once('listening', resolve))
    const address = s.address()
    if (!address || typeof address === 'string') throw new Error('missing address')
    return `http://127.0.0.1:${address.port}`
  }
  beforeAll(async () => {
    await migrate(pool)
    devOrigin = await listen({ ...baseConfig, admin: { ...admin, devLoginEmail: DEV_EMAIL } })
    plainOrigin = await listen({ ...baseConfig, admin })
  })
  afterAll(async () => {
    for (const s of servers) await new Promise<void>((resolve) => s.close(() => resolve()))
    await pool.end()
  })
  beforeEach(async () => {
    await pool.query('TRUNCATE vendor_accounts, service_nonces, audit_events CASCADE')
  })

  async function post(path: string, to: string, extra: Record<string, string> = {}) {
    const raw = '{}'
    const headers = signServiceRequest({ method: 'POST', path, body: raw, actor: 'anonymous', anonymous: true, issuer: baseConfig.installationId, key })
    const res = await fetch(to + path, { method: 'POST', headers: { ...headers, ...extra, 'content-type': 'application/json' }, body: raw })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : undefined }
  }
  const devOwner = () => transaction(pool, (c) => ensureDevOwner(c, DEV_EMAIL, 'Dev'))
  const resolve = (session: string) => transaction(pool, (c) => resolveSession(c, session, new Date()))

  it('does not exist without ADMIN_DEV_LOGIN_EMAIL', async () => {
    await devOwner()
    for (const path of ['/v1/admin/auth/dev-login', '/v1/admin/auth/dev-step-up']) {
      const result = await post(path, plainOrigin)
      expect([result.status, adminErrorBodySchema.parse(result.body)]).toEqual([404, { code: 'not_found' }])
    }
    expect((await pool.query("SELECT 1 FROM audit_events WHERE reason='dev-login'")).rowCount).toBe(0)
  })

  it('signs the configured account in with a fresh step-up and audits it', async () => {
    const { id } = await devOwner()
    const result = await post('/v1/admin/auth/dev-login', devOrigin)
    expect(result.status).toBe(200)
    const session = adminSessionResultSchema.parse(result.body).session
    expect(session.startsWith(`${id}.`)).toBe(true)
    expect((await resolve(session)).stepUpFresh).toBe(true)
    const audited = await pool.query("SELECT actor, subject FROM audit_events WHERE action='auth.signed_in' AND reason='dev-login'")
    expect(audited.rows).toEqual([{ actor: `account:${id}`, subject: `account:${id}` }])
  })

  it('answers 401 auth_failed when the configured account does not exist', async () => {
    const result = await post('/v1/admin/auth/dev-login', devOrigin)
    expect([result.status, result.body]).toEqual([401, { code: 'auth_failed' }])
  })

  it('confirms step-up only for the configured account', async () => {
    const { id } = await devOwner()
    const other = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES('other@webvue.sa','Other','active','x') RETURNING id")).rows[0].id)
    const sessionOf = (accountId: number) => transaction(pool, async (c) => (await createSession(c, accountId, new Date(), false)).session)
    const own = await sessionOf(id)
    const foreign = await sessionOf(other)

    const denied = await post('/v1/admin/auth/dev-step-up', devOrigin, { 'x-webvue-session': foreign })
    expect([denied.status, denied.body]).toEqual([401, { code: 'auth_failed' }])
    expect((await resolve(foreign)).stepUpFresh).toBe(false)

    const missing = await post('/v1/admin/auth/dev-step-up', devOrigin)
    expect(missing.status).toBe(401)

    expect((await post('/v1/admin/auth/dev-step-up', devOrigin, { 'x-webvue-session': own })).status).toBe(204)
    expect((await resolve(own)).stepUpFresh).toBe(true)
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='auth.step_up' AND reason='dev-login'")).rowCount).toBe(1)
  })

  it('ensureDevOwner creates an owner without a usable credential and is idempotent', async () => {
    const first = await devOwner()
    expect(first.created).toBe(true)
    const row = (await pool.query('SELECT status, password_hash FROM vendor_accounts WHERE id=$1', [first.id])).rows[0]
    expect(row.status).toBe('active')
    expect(await verifyPassword(row.password_hash, '!')).toBe(false)
    expect((await pool.query('SELECT count(*)::int AS n FROM vendor_passkeys WHERE account_id=$1', [first.id])).rows[0].n).toBe(0)
    expect((await pool.query('SELECT role FROM vendor_account_roles WHERE account_id=$1', [first.id])).rows).toEqual([{ role: 'owner' }])

    const again = await devOwner()
    expect(again).toEqual({ id: first.id, created: false })
    await pool.query('DELETE FROM vendor_account_roles WHERE account_id=$1', [first.id])
    await devOwner()
    expect((await pool.query('SELECT role FROM vendor_account_roles WHERE account_id=$1', [first.id])).rows).toEqual([{ role: 'owner' }])
  })

  it.each(['disabled', 'enrolling'])('ensureDevOwner refuses an existing %s account and changes nothing', async (status) => {
    const id = Number((await pool.query("INSERT INTO vendor_accounts(email,display_name,status,password_hash) VALUES($1,'Dev',$2,NULL) RETURNING id", [DEV_EMAIL, status])).rows[0].id)
    await expect(devOwner()).rejects.toThrow(new RegExp(`${status}`))
    expect((await pool.query('SELECT status, password_hash FROM vendor_accounts WHERE id=$1', [id])).rows[0]).toEqual({ status, password_hash: null })
    expect((await pool.query('SELECT 1 FROM vendor_account_roles WHERE account_id=$1', [id])).rowCount).toBe(0)
  })

  it('assertLoopbackDatabase accepts only a loopback database host', () => {
    for (const ok of ['postgresql://127.0.0.1:5432/x', 'postgresql://localhost/x', 'postgresql://u:p@[::1]:5432/x']) expect(() => assertLoopbackDatabase(ok)).not.toThrow()
    for (const bad of ['postgresql://db.example.com/x', 'postgresql://10.0.0.5/x', 'postgresql:///x']) expect(() => assertLoopbackDatabase(bad)).toThrow(/loopback/)
  })
})
