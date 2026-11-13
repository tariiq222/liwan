import { describe, expect, it, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { signServiceRequest } from '@liwan/commercial-contracts/server'
import { url, setup } from './commercial-helpers.js'
import { createApp } from '../http.js'
import { createCommercialScheduler } from '../commercial/scheduler.js'
import { tenantReturnOrigin } from '../commercial/return-origin.js'
import type { MailAdapter, MailMessage } from '../commercial/mail-adapter.js'
import { FIND_WORKSPACE_PATH } from '../commercial/workspace-lookup-http.js'
import {
  processWorkspaceLookups, queueWorkspaceLookup, runWorkspaceLookups, sendWorkspaceLookupNotices, workspaceLookupMail,
  WORKSPACE_LOOKUP_ACTION, WORKSPACE_LOOKUP_COOLDOWN_SECONDS, WORKSPACE_LOOKUP_DAILY_LIMIT, WORKSPACE_LOOKUP_HOURLY_LIMIT,
  WORKSPACE_LOOKUP_KIND, WORKSPACE_LOOKUP_NOTICE_KIND,
} from '../commercial/workspace-lookup.js'

const d = url ? describe : describe.skip
d('find my workspace', () => {
  let pool: Pool
  const sent: MailMessage[] = []
  const mail: MailAdapter = { async send(m) { sent.push(m); return { accepted: true, provider_message_id: 'p-' + m.message_id } } }
  const origin = (p: Pool) => tenantReturnOrigin(p, ['https://*.liwan.test'])
  beforeAll(async () => { pool = new Pool({ connectionString: url }); await setup(pool) })
  afterAll(async () => { await pool.end() })
  beforeEach(async () => {
    sent.length = 0
    await pool.query(`TRUNCATE commercial_outbox, service_nonces`)
    await pool.query(`UPDATE customers SET admin_login=NULL WHERE admin_login LIKE '%@x.test'`)
    await pool.query(`DELETE FROM audit_events WHERE action=$1`, [WORKSPACE_LOOKUP_ACTION])
  })

  /** A delivered workspace of `admin` on `host`: enabled binding and an applied first plan. */
  async function workspace(o: { admin?: string | null; name?: string; enabled?: boolean; applied?: boolean; bound?: boolean; subscription?: string } = {}) {
    const tenant = randomUUID(), customer = randomUUID(), host = `t${randomUUID().replaceAll('-', '').slice(0, 12)}.liwan.test`
    await pool.query(`INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'T','saas','dedicated_managed',$2,true)`, [tenant, 'wl-' + tenant])
    await pool.query(`INSERT INTO customers(id,name,tenant_id,admin_login) VALUES($1,$2,$3,$4)`, [customer, o.name ?? 'شركة', tenant, o.admin === undefined ? 'admin@x.test' : o.admin])
    if (o.bound !== false) {
      const db = 'liwan_t' + tenant.replaceAll('-', '').slice(0, 20)
      await pool.query(`INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,$5,1)`,
        [tenant, 't' + tenant.replaceAll('-', '').slice(0, 20), host, db, o.enabled !== false])
    }
    const sub = randomUUID()
    await pool.query('INSERT INTO subscriptions(id,customer_id,tenant_id) VALUES($1,$2,$3)', [sub, customer, tenant])
    if (o.applied !== false) {
      const revision = randomUUID()
      await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, sub, '{}', randomUUID()])
      await pool.query('UPDATE subscriptions SET applied_revision_id=$1, revision=revision+1 WHERE id=$2', [revision, sub])
    }
    if (o.subscription) await pool.query(`UPDATE subscriptions SET state=$2, revision=revision+1 WHERE id=$1`, [sub, o.subscription])
    return { tenant, customer, host, sub }
  }
  const ask = (email: string) => queueWorkspaceLookup(pool, { email, client_address: '203.0.113.7' })
  const run = async () => { const r = await runWorkspaceLookups(pool, { mail, returnOrigin: origin(pool) }); return r }
  const lookupRows = async () => (await pool.query(`SELECT status, payload FROM commercial_outbox WHERE kind=$1 ORDER BY created_at`, [WORKSPACE_LOOKUP_KIND])).rows
  const mailed = async () => (await pool.query(`SELECT subject, metadata FROM audit_events WHERE action=$1`, [WORKSPACE_LOOKUP_ACTION])).rows

  describe('the worker', () => {
    it('mails the address on record, once, with the workspace and its sign-in address, and no token', async () => {
      const w = await workspace({ name: 'شركة النور' })
      await ask('Admin@X.test')
      expect(await run()).toEqual({ handled: 1, sent: 1 })
      expect(sent).toHaveLength(1)
      expect(sent[0]!.to).toBe('admin@x.test')
      expect(sent[0]!.text).toContain(`شركة النور: https://${w.host}/login`)
      expect(sent[0]!.text).toContain('Your workspaces')
      expect(sent[0]!.text).not.toMatch(/token|password/i)
      expect(sent[0]!.text).not.toContain('?')
    })
    it('lists every workspace of the address in one mail', async () => {
      const a = await workspace({ name: 'First' }), b = await workspace({ name: 'Second' }), c = await workspace({ admin: 'other@x.test', name: 'Other' })
      await ask('admin@x.test')
      await run()
      expect(sent).toHaveLength(1)
      expect(sent[0]!.text).toContain(a.host); expect(sent[0]!.text).toContain(b.host); expect(sent[0]!.text).not.toContain(c.host)
    })
    it('sends nothing for an unknown address and leaves no trace of the typed one', async () => {
      await workspace()
      await ask('nobody@x.test')
      expect(await run()).toEqual({ handled: 1, sent: 0 })
      expect(sent).toEqual([])
      expect((await lookupRows()).map(r => [r.status, 'email' in r.payload])).toEqual([['done', false]])
      expect(await mailed()).toEqual([])
    })
    it('sends nothing for a disabled binding, an unbound customer, an undelivered workspace or a customer without an address', async () => {
      await workspace({ enabled: false }); await workspace({ bound: false }); await workspace({ applied: false })
      await ask('admin@x.test'); await run()
      expect(sent).toEqual([])
    })
    it('still mails a suspended workspace so its manager can find it to pay', async () => {
      const w = await workspace({ subscription: 'suspended' })
      await ask('admin@x.test'); await run()
      expect(sent[0]!.text).toContain(w.host)
    })
    it('still mails a workspace whose deletion is confirmed or due: it exists until the vendor removes it', async () => {
      for (const state of ['confirmed', 'due']) {
        sent.length = 0
        await pool.query(`DELETE FROM audit_events WHERE action=$1`, [WORKSPACE_LOOKUP_ACTION])
        const email = `${state}@x.test`
        const w = await workspace({ admin: email })
        await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,renewal_outcome) VALUES($1,$2,$3,now(),'t',now(),'t',now(),CASE WHEN $3='due' THEN now() END,'cancelled')`, [randomUUID(), w.customer, state])
        await ask(email); await run()
        expect(sent.map(m => m.to)).toEqual([email])
        expect(sent[0]!.text).toContain(w.host)
      }
    })
    it('leaves out a workspace disabled between the decision and the send', async () => {
      const w = await workspace()
      await ask('admin@x.test'); await processWorkspaceLookups(pool)
      await pool.query('UPDATE shared_registry_bindings SET enabled=false, registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [w.tenant])
      expect(await sendWorkspaceLookupNotices(pool, { mail, returnOrigin: origin(pool) })).toBe(0)
      expect(sent).toEqual([])
    })
    it('mails an address at most once per cooldown, even when the requests are handled in parallel', async () => {
      await workspace()
      for (let n = 0; n < 8; n++) await ask('admin@x.test')
      await Promise.all(Array.from({ length: 4 }, () => processWorkspaceLookups(pool, { limit: 2 })))
      expect((await lookupRows()).every(r => r.status === 'done')).toBe(true)
      expect(await mailed()).toHaveLength(1)
      expect((await pool.query(`SELECT count(*)::int AS n FROM commercial_outbox WHERE kind=$1`, [WORKSPACE_LOOKUP_NOTICE_KIND])).rows[0].n).toBe(1)
      await sendWorkspaceLookupNotices(pool, { mail, returnOrigin: origin(pool) })
      expect(sent).toHaveLength(1)
      expect(WORKSPACE_LOOKUP_COOLDOWN_SECONDS).toBe(60)
    })
    it('stops at the hourly cap once the cooldown has passed', async () => {
      const w = await workspace()
      for (let n = 0; n < WORKSPACE_LOOKUP_HOURLY_LIMIT - 1; n++) {
        await pool.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata,created_at) VALUES($1,'a',$2,$3,'r',$4,now() - interval '10 minutes')`,
          [randomUUID(), WORKSPACE_LOOKUP_ACTION, w.customer, JSON.stringify({ mail_id: randomUUID() })])
      }
      for (let n = 0; n < 5; n++) await ask('admin@x.test')
      await Promise.all([processWorkspaceLookups(pool, { limit: 3 }), processWorkspaceLookups(pool, { limit: 3 })])
      expect((await mailed()).length).toBe(WORKSPACE_LOOKUP_HOURLY_LIMIT)
      // An hour later the address may be mailed again.
      await pool.query(`UPDATE audit_events SET created_at = now() - interval '2 hours' WHERE action=$1`, [WORKSPACE_LOOKUP_ACTION])
      await ask('admin@x.test'); await processWorkspaceLookups(pool)
      expect((await mailed()).length).toBe(WORKSPACE_LOOKUP_HOURLY_LIMIT + 1)
    })
    it('stops at the daily ceiling for every address', async () => {
      await workspace()
      for (let n = 0; n < WORKSPACE_LOOKUP_DAILY_LIMIT; n++) {
        await pool.query(`INSERT INTO audit_events(id,actor,action,subject,reason,metadata,created_at) VALUES($1,'a',$2,$3,'r',$4,now() - interval '3 hours')`,
          [randomUUID(), WORKSPACE_LOOKUP_ACTION, randomUUID(), JSON.stringify({ mail_id: randomUUID() })])
      }
      await ask('admin@x.test'); await run()
      expect(sent).toEqual([])
    })
    it('retries a failed request, then fails it for good and removes the typed address', async () => {
      // A row whose address cannot be read fails every attempt.
      await pool.query(`INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload) VALUES($1::uuid,$2,$1::text,$1::text,$3)`, [randomUUID(), WORKSPACE_LOOKUP_KIND, JSON.stringify({ email: 5, client_address: '203.0.113.7' })])
      const logs: string[] = []
      for (let n = 0; n < 5; n++) {
        await processWorkspaceLookups(pool, { log: m => logs.push(m) })
        await pool.query(`UPDATE commercial_outbox SET next_attempt_at=now() WHERE kind=$1`, [WORKSPACE_LOOKUP_KIND])
      }
      expect((await lookupRows()).map(r => [r.status, 'email' in r.payload])).toEqual([['failed', false]])
      expect(logs).toHaveLength(5)
    })
    it('writes the mail in Arabic then English and flattens line breaks in a workspace name', () => {
      const m = workspaceLookupMail([{ name: 'A\nB', url: 'https://t.liwan.test/login' }])
      expect(m.text.indexOf('طُلب')).toBeLessThan(m.text.indexOf('Someone asked'))
      expect(m.text).toContain('- A B: https://t.liwan.test/login')
      expect(m.text).toContain('nothing needs doing')
    })
  })

  describe('over HTTP', () => {
    const key = 'customer-test-key-'.repeat(4)
    const config = { installationId: 'wl-http', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'i', customerCommercialServiceKey: key,
      inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' }
    let checked: string[] = []
    let verdict: 'pass' | 'fail' | 'throw' = 'pass'
    const humanCheck = async (token: string) => { checked.push(token); if (verdict === 'throw') throw new Error('down'); return verdict === 'pass' && token === 'good' }
    let server: ReturnType<ReturnType<typeof createApp>['listen']>, bare: typeof server, port = 0, barePort = 0
    const listen = async (app: typeof server) => { app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => app.once('listening', resolve)); const a = app.address(); if (!a || typeof a === 'string') throw Error('address'); return a.port }
    beforeAll(async () => {
      server = createApp(pool, config, { humanCheck }); port = await listen(server)
      bare = createApp(pool, config); barePort = await listen(bare)
    })
    afterAll(async () => { for (const s of [server, bare]) await new Promise<void>(resolve => s.close(() => resolve())) })
    beforeEach(() => { checked = []; verdict = 'pass' })

    // The injected human check accepts this value; a named constant, since it is not a credential.
    const PASSING_CHECK = 'good'
    const send = (o: { email?: string; token?: string | null; ip?: string | null; signingKey?: string; raw?: string; port?: number; replayOf?: Record<string, string> } = {}) => {
      const ip = o.ip === undefined ? '198.51.100.20' : o.ip
      const raw = o.raw ?? JSON.stringify({ email: o.email ?? 'admin@x.test', ...(o.token === null ? {} : { human_token: o.token ?? PASSING_CHECK }) })
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (o.replayOf) Object.assign(headers, o.replayOf)
      else if (ip !== null) Object.assign(headers, { 'x-liwan-client-ip': ip },
        signServiceRequest({ method: 'POST', path: FIND_WORKSPACE_PATH, body: `liwan-find-workspace:${ip}\n${raw}`, actor: 'anonymous', anonymous: true, issuer: 'i', key: o.signingKey ?? key }))
      return { headers, raw, post: () => fetch(`http://127.0.0.1:${o.port ?? port}${FIND_WORKSPACE_PATH}`, { method: 'POST', headers, body: raw }) }
    }
    const go = (o: Parameters<typeof send>[0] = {}) => send(o).post()

    it('answers 202 {ok:true} alike for a managed address and a stranger, queues identical rows, and mails only after the worker ran', async () => {
      await workspace()
      const wrong = await go({ email: 'nobody@x.test', ip: '198.51.100.21' })
      const right = await go({ email: 'admin@x.test', ip: '198.51.100.22' })
      expect([wrong.status, right.status]).toEqual([202, 202])
      expect(await wrong.json()).toEqual({ ok: true }); expect(await right.json()).toEqual({ ok: true })
      const rows = await lookupRows()
      expect(rows.map(r => r.status)).toEqual(['pending', 'pending'])
      expect(rows.map(r => Object.keys(r.payload).sort())).toEqual([['client_address', 'email'], ['client_address', 'email']])
      expect(await mailed()).toEqual([])
      expect(await run()).toEqual({ handled: 2, sent: 1 })
      expect(sent.map(m => m.to)).toEqual(['admin@x.test'])
      expect((await lookupRows()).map(r => 'email' in r.payload)).toEqual([false, false])
      expect(checked).toEqual(['good', 'good'])
    })
    it('refuses a request that is unsigned, signed with another key, has no visitor address, or whose body was changed', async () => {
      expect((await go({ ip: null })).status).toBe(403)
      expect((await go({ signingKey: 'forged-test-key-'.repeat(4) })).status).toBe(403)
      const signed = send({ ip: '198.51.100.23' })
      const swapped = await fetch(`http://127.0.0.1:${port}${FIND_WORKSPACE_PATH}`, { method: 'POST', headers: signed.headers, body: JSON.stringify({ email: 'x@x.test', human_token: 'good' }) })
      expect(swapped.status).toBe(403)
      const forgedAddress = await fetch(`http://127.0.0.1:${port}${FIND_WORKSPACE_PATH}`, { method: 'POST', headers: { ...signed.headers, 'x-liwan-client-ip': '198.51.100.99' }, body: signed.raw })
      expect(forgedAddress.status).toBe(403)
      expect(await lookupRows()).toEqual([]); expect(checked).toEqual([])
    })
    it('accepts one signed request once: a replay is refused and queues nothing more', async () => {
      const first = send({ ip: '198.51.100.24' })
      expect((await first.post()).status).toBe(202)
      expect((await send({ replayOf: first.headers, raw: first.raw }).post()).status).toBe(403)
      expect(await lookupRows()).toHaveLength(1)
    })
    it('requires the human check on every request and fails closed, queuing nothing', async () => {
      expect((await go({ token: null, ip: '198.51.100.25' })).status).toBe(400)
      expect((await go({ token: 'bad', ip: '198.51.100.26' })).status).toBe(422)
      verdict = 'throw'
      const down = await go({ ip: '198.51.100.27' })
      expect([down.status, (await down.json()).code]).toEqual([503, 'human_check_unavailable'])
      // An app without the sign-up human check configured refuses every request.
      expect((await go({ ip: '198.51.100.28', port: barePort })).status).toBe(503)
      expect(await lookupRows()).toEqual([])
    })
    it('limits each signed visitor address to 5 requests in ten minutes', async () => {
      const statuses: number[] = []
      for (let n = 0; n < 6; n++) statuses.push((await go({ email: 'nobody@x.test', ip: '198.51.100.30' })).status)
      expect(statuses).toEqual([202, 202, 202, 202, 202, 429])
      expect((await go({ ip: '198.51.100.31' })).status).toBe(202)
    })
    it('rejects a non-POST, extra fields and an oversize body', async () => {
      expect((await fetch(`http://127.0.0.1:${port}${FIND_WORKSPACE_PATH}`)).status).toBe(404)
      expect((await go({ raw: JSON.stringify({ email: 'a@x.test', human_token: 'good', tenant_id: 'x' }), ip: '198.51.100.40' })).status).toBe(400)
      expect((await go({ email: 'a'.repeat(300) + '@x.test', ip: '198.51.100.41' })).status).toBe(400)
      expect((await go({ raw: JSON.stringify({ email: 'a@x.test', human_token: 'x'.repeat(5000) }), ip: '198.51.100.42' })).status).toBe(413)
      expect(await lookupRows()).toEqual([])
    })
  })

  it('is a scheduler job: a tick decides the queued request and mails the address on record', async () => {
    const w = await workspace()
    await ask('admin@x.test')
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    const scheduler = createCommercialScheduler({ pool, config: {} as never, env: { LIWAN_TENANCY_MODE: 'shared', LIWAN_PAYMENT_RETURN_ORIGINS: 'https://*.liwan.test' }, mailAdapter: mail, log: () => {} })
    await scheduler.tick()
    const tick = JSON.parse((console.debug as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)![0])
    expect(tick.jobs['workspace-lookup']).toEqual({ runs: 1, failures: 0 })
    expect(sent.map(m => m.to)).toEqual(['admin@x.test'])
    expect(sent[0]!.text).toContain(w.host)
  })
})
