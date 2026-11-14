import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Pool } from 'pg'
import { TENANT_DELETION_HOLD_HOURS } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'
import { attention } from '../commercial/attention.js'
import { withdrawDeletion, requestDeletion, markDueDeletions } from '../commercial/tenant-deletion.js'
import { runTenantDeletions, queueLastCalls, tenantDeletionEnabled, type TenantDeletionDeps } from '../commercial/tenant-deletion-run.js'
import { sendTenantDeletionNotices, tenantDeletionNotice } from '../commercial/tenant-deletion-notices.js'
import { tenantDeletionRunOf, deletionClockRunningSql } from '../commercial/tenant-deletion-read.js'
import { planDigestOf, canonicalJson } from '../commercial/tenant-deletion-plan.js'
import type { DeletionEffects } from '../commercial/tenant-deletion-effects.js'
import { createDeletionEffects } from '../shared/tenant-deletion-effects-runner.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { tenantDeletionActor } from '../shared/tenant-deletion-authority.js'
import { lockTenantJobs } from '../shared/job-store.js'
import { transaction } from '../db.js'
import type { PaymentAdapter } from '../commercial/payment-adapter.js'

const suite = url ? describe : describe.skip
const config = { installationId: 'del-run', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'del-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4), inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' } as any
const who = { actor: 'tester', client_address: null }

/** Effects that record every call, can fail a named call once, and re-check ownership before a mutation as the real runner does at a permit. */
class FakeEffects implements DeletionEffects {
  calls: string[] = []
  failures = new Map<string, string[]>()
  after?: (name: string) => Promise<void>
  private async hit(name: string) {
    this.calls.push(name)
    const queue = this.failures.get(name)
    if (queue?.length) throw new Error(queue.shift()!)
    await this.after?.(name)
  }
  stage: DeletionEffects['stage'] = async input => {
    if (!input.dryRun) await input.assertOwned()
    await this.hit(input.dryRun ? `dry:${input.stage}` : input.stage)
    return { state: input.dryRun ? 'would' : 'done' }
  }
  purgeOffsite: DeletionEffects['purgeOffsite'] = async input => { await input.assertOwned(); await this.hit('purge_offsite'); return { state: 'empty' } }
  unbindRelay: DeletionEffects['unbindRelay'] = async () => { await this.hit('unbind_relay'); return { state: 'not_configured' } }
  removeBackupArtifacts: DeletionEffects['removeBackupArtifacts'] = async paths => { await this.hit('remove_artifacts'); return { removed: paths.length } }
}

suite('the final deletion of a workspace: the runner, its ledger, its guards and its notices', () => {
  const pool = new Pool({ connectionString: url, max: 12 })
  const registryDir = mkdtempSync(join(tmpdir(), 'del-registry-'))
  const registryPath = join(registryDir, 'registry.json')
  let effects: FakeEffects
  const cardCalls: string[] = []
  let cardFails = false
  const adapter = { provider: 'simulator', mode: 'simulator', deleteToken: async (token: string) => { if (cardFails) throw new Error('provider down'); cardCalls.push(token) } } as unknown as PaymentAdapter
  const deps = (over: Partial<TenantDeletionDeps> = {}): TenantDeletionDeps => ({ pool, config, effects, enabled: true, registryPath, paymentAdapter: adapter, log: (m, e) => console.error('RUNLOG %s', m, e instanceof Error ? e.stack : e), ...over })
  const run = (over: Partial<TenantDeletionDeps> = {}) => runTenantDeletions(deps(over))
  /** Passes every backoff and deferral wait, as if the time had come. */
  const settle = () => pool.query('UPDATE tenant_deletion_steps SET next_attempt_at=NULL WHERE next_attempt_at IS NOT NULL')

  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { effects = new FakeEffects(); cardFails = false; cardCalls.length = 0; await pool.query('TRUNCATE tenant_deletion_steps, tenant_deletion_requests'); await pool.query('TRUNCATE commercial_outbox') })
  afterAll(async () => { await pool.end() })

  /** A customer with a workspace whose request is `due` and whose hold has ended `holdEnded` minutes ago (negative: still running). */
  async function fixture(opts: { holdEndedMinutes?: number; card?: boolean; backup?: boolean; dueNotice?: boolean } = {}) {
    const customer = randomUUID(), tenant = randomUUID(), request = randomUUID()
    const slug = `t${tenant.replaceAll('-', '').slice(0, 20)}`
    const database = `liwan_scratch_${slug.slice(1)}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled,status) VALUES($1,$2,'saas','shared_managed',$3,true,'active')", [tenant, `Tenant ${slug}`, slug])
    await pool.query('INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)', [customer, `Company ${slug}`, tenant, 'Manager Name', `${slug}@example.test`])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [tenant, slug, `${slug}.test`, database])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [randomUUID(), customer, tenant])
    await pool.query(`INSERT INTO tenant_deletion_requests(id,customer_id,state,requested_at,requested_by,confirmed_at,confirmed_by,due_at,due_marked_at,hold_until,renewal_outcome,renewal_refusal)
      VALUES($1,$2,'due',now() - interval '100 days','manager',now() - interval '93 days','manager',now() - interval '3 days',now() - interval '3 days',now() - make_interval(mins => $3),'not_cancellable','no_subscription')`,
    [request, customer, opts.holdEndedMinutes ?? 1])
    if (opts.dueNotice !== false) await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'tenant_deletion.notice',$2,$3,'{}','done',now())", [randomUUID(), request, `due:${request}`])
    let card: string | undefined, backup: string | undefined
    if (opts.card) { card = randomUUID(); await pool.query(`INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,status,is_default,consent_at,consent_text_version,created_by)
      VALUES($1,$2,'simulator','simulator',$3,'visa','4242',12,2030,'active',false,now(),'v1','test')`, [card, customer, `tok_${card}`]) }
    if (opts.backup) {
      backup = randomUUID()
      await pool.query(`INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by)
        VALUES($1,$2,$3,$4,$4,'{"schemaVersion":1}',$5,$5,$6,'verified','test')`, [backup, tenant, slug, database, 'a'.repeat(64), `/tmp/del-${backup}.json`])
    }
    return { customer, tenant, request, slug, database, card, backup, login: `${slug}@example.test` }
  }
  type Fx = Awaited<ReturnType<typeof fixture>>
  const req = async (f: Fx) => (await pool.query('SELECT * FROM tenant_deletion_requests WHERE id=$1', [f.request])).rows[0]
  const steps = async (f: Fx) => Object.fromEntries((await pool.query('SELECT * FROM tenant_deletion_steps WHERE request_id=$1', [f.request])).rows.map(r => [r.step, r]))
  const binding = async (f: Fx) => (await pool.query('SELECT enabled,retired,registry_revision::int AS rev FROM shared_registry_bindings WHERE control_tenant_id=$1', [f.tenant])).rows[0]
  const refused = async (p: Promise<unknown>) => p.then(() => null, (e: any) => ({ code: e.code ?? e.message, status: e.status }))
  /** Runs until nothing more moves (each pass can wait out a backoff). */
  const drive = async (passes = 6) => { for (let i = 0; i < passes; i++) { await settle(); await run() } }

  it('carries a due request through every step in order and records each step, its evidence and the registry result', async () => {
    const f = await fixture({ card: true, backup: true })
    await run()
    const row = await req(f)
    expect(row).toMatchObject({ state: 'deleted', stuck_code: null })
    expect(row.committed_at).toBeInstanceOf(Date); expect(row.deleted_at).toBeInstanceOf(Date)
    const ledger = await steps(f)
    expect(Object.keys(ledger).sort()).toEqual(['clean_registry_rows', 'commit', 'delete_cards', 'drop_database', 'finish', 'preflight', 'purge_local_backups', 'purge_offsite', 'remove_filestore', 'remove_restore_copies', 'remove_side_files', 'stop_access', 'unbind_relay', 'anonymise_contacts'].sort())
    expect(ledger.unbind_relay).toMatchObject({ state: 'skipped', error_code: 'relay_not_configured' })
    for (const [name, step] of Object.entries(ledger)) if (name !== 'unbind_relay' && name !== 'anonymise_contacts') expect(step, name).toMatchObject({ state: 'done', failures: 0 })
    expect(ledger.anonymise_contacts).toMatchObject({ state: 'pending', error_code: 'final_mail_pending' })
    // The database goes before any backup, and the off-site purge comes after the local one.
    expect(effects.calls.filter(c => !c.startsWith('dry:'))).toEqual(['unbind_relay', 'drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_artifacts', 'purge_offsite', 'remove_side_files'])
    expect(cardCalls).toEqual([`tok_${f.card}`])
    expect((await pool.query('SELECT status,provider_token FROM payment_methods WHERE id=$1', [f.card])).rows[0]).toEqual({ status: 'removed', provider_token: null })
    expect(await binding(f)).toMatchObject({ enabled: false, retired: true })
    const published = JSON.parse(readFileSync(registryPath, 'utf8')).targets.find((t: any) => t.tenantId === f.slug)
    expect(published).toMatchObject({ enabled: false, retired: true, database: f.database })
    expect((await pool.query('SELECT status,operations_enabled FROM tenants WHERE id=$1', [f.tenant])).rows[0]).toEqual({ status: 'deleted', operations_enabled: false })
    expect((await pool.query('SELECT state FROM subscriptions WHERE customer_id=$1', [f.customer])).rows[0].state).toBe('cancelled')
    expect((await pool.query('SELECT purged_at,artifact_path,snapshot FROM shared_backups WHERE id=$1', [f.backup])).rows[0]).toMatchObject({ artifact_path: null, snapshot: {} })
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE subject=$1 AND action='tenant_deletion.deleted'", [f.customer])).rows[0].n).toBe(1)
    // Evidence is names and counts only.
    expect(JSON.stringify(ledger)).not.toContain(f.login)
    // The vendor's read-only view.
    const view = await tenantDeletionRunOf(pool, f.customer, true)
    expect(view).toMatchObject({ enabled: true, request: { state: 'deleted' }, plan: { database: f.database, backups: 1, cards: 1 } })
    expect(view!.steps.map(s => s.step)).toContain('purge_offsite')
  })

  it('anonymises the contacts only after the final mail is closed, and scrubs recipients and codes from this customer only', async () => {
    const f = await fixture(), other = await fixture({ holdEndedMinutes: -600 })
    const aggregate = randomUUID()
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'billing.notice',$2,'x',(jsonb_build_object('to','a@b.test','customer_id',$3::text,'code','123456','kept',1)),'done',now())", [randomUUID(), aggregate, f.customer])
    await pool.query("INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),'x','admin_login.changed',$1,'',$2::jsonb)", [f.customer, JSON.stringify({ admin_login: f.login, note: 'kept' })])
    await run()
    expect((await req(f)).state).toBe('deleted')
    // The final mail is still queued: nothing is anonymised and the step defers.
    expect((await steps(f)).anonymise_contacts).toMatchObject({ state: 'pending', error_code: 'final_mail_pending' })
    expect((await pool.query('SELECT admin_login FROM customers WHERE id=$1', [f.customer])).rows[0].admin_login).toBe(f.login)
    const mails: { to: string; subject: string; text: string }[] = []
    await sendTenantDeletionNotices(pool, { mail: { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } } })
    const finalMail = mails.find(m => m.subject === 'اكتمل حذف مساحة العمل في LiwanOS')!
    expect(finalMail.to).toBe(f.login)
    for (const kept of ['الفواتير وسجلات الدفع', 'invoices and payment records', 'Meta', 'TikTok', 'free-trial record']) expect(finalMail.text).toContain(kept)
    await settle(); await run()
    expect((await steps(f)).anonymise_contacts).toMatchObject({ state: 'done' })
    expect((await pool.query('SELECT admin_name,admin_login FROM customers WHERE id=$1', [f.customer])).rows[0]).toEqual({ admin_name: null, admin_login: null })
    // After `deleted` and the scrub no recipient or code is left in any outbox payload or audit metadata of this customer.
    const leftovers = await pool.query(`SELECT 1 FROM commercial_outbox WHERE payload::text LIKE '%' || $1 || '%' OR payload::text LIKE '%a@b.test%' OR payload::text LIKE '%123456%'
      UNION ALL SELECT 1 FROM audit_events WHERE subject=$2 AND metadata::text LIKE '%' || $1 || '%'`, [f.login, f.customer])
    expect(leftovers.rowCount).toBe(0)
    expect((await pool.query("SELECT payload FROM commercial_outbox WHERE aggregate_id=$1", [aggregate])).rows[0].payload).toEqual({ customer_id: f.customer, kept: 1 })
    expect((await pool.query('SELECT admin_login FROM customers WHERE id=$1', [other.customer])).rows[0].admin_login).toBe(other.login)
  })

  it('with the kill switch off records the plan and would-do lines and runs nothing destructive, then deletes once it is on', async () => {
    const f = await fixture({ card: true })
    expect(tenantDeletionEnabled({})).toBe(false)
    expect(tenantDeletionEnabled({ LIWAN_TENANT_DELETION_ENABLED: '1' })).toBe(false)
    expect(tenantDeletionEnabled({ LIWAN_TENANT_DELETION_ENABLED: 'true' })).toBe(true)
    await run({ enabled: false })
    expect((await req(f)).state).toBe('due')
    expect(effects.calls.every(c => c.startsWith('dry:'))).toBe(true)
    expect(effects.calls).toContain('dry:drop_database')
    expect(cardCalls).toEqual([])
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    const dry = (await steps(f)).preflight
    expect(dry).toMatchObject({ state: 'skipped', error_code: 'kill_switch_off' })
    expect(dry.evidence.would_do.join('\n')).toContain('would stop access')
    // An hour-old record is not rewritten on every tick.
    const before = effects.calls.length
    await run({ enabled: false })
    expect(effects.calls.length).toBe(before)
    await run({ enabled: true })
    expect((await req(f)).state).toBe('deleted')
    expect((await steps(f)).preflight).toMatchObject({ state: 'done', error_code: null })
  })

  it('does not start before the hold ends and gives the last call once, 24 hours before it ends', async () => {
    const f = await fixture({ holdEndedMinutes: -(TENANT_DELETION_HOLD_HOURS * 60 - 60) })
    await run()
    expect((await req(f)).state).toBe('due')
    expect(effects.calls).toEqual([])
    // 71 hours left of a hold that started 1 hour ago: not yet the last call; at 23 hours left it goes, once.
    expect(await queueLastCalls(pool)).toBe(0)
    await pool.query("UPDATE tenant_deletion_requests SET hold_until=now() + interval '23 hours' WHERE id=$1", [f.request])
    expect(await queueLastCalls(pool)).toBe(1)
    expect(await queueLastCalls(pool)).toBe(0)
    const notice = tenantDeletionNotice({ type: 'last_call', request_id: f.request }, { name: 'Acme', due_on: '2026-11-14', final_at: '2026-11-17 05:37', renewal_outcome: null, renewal_refusal: null }, 3)
    expect(notice.text).toContain('2026-11-17 05:37')
    expect(notice.text).toContain('24')
    const start = tenantDeletionNotice({ type: 'deleting', request_id: f.request }, { name: 'Acme', due_on: '2026-11-14', final_at: '2026-11-17 05:37', renewal_outcome: null, renewal_refusal: null }, 3)
    expect(start.text).toContain('access is stopped now')
  })

  it('accepts a withdrawal in the hold and before the point of no return (vendor only once deleting), refuses it after, and reinstates the workspace', async () => {
    // In the hold: the customer withdraws and nothing is touched.
    const held = await fixture({ holdEndedMinutes: -600 })
    await withdrawDeletion(pool, { ...who, customer_id: held.customer, by: 'customer', reason: null })
    expect((await req(held)).state).toBe('withdrawn')
    await run()
    expect(effects.calls).toEqual([])
    // Deleting, before the commit: the relay step fails once so the request waits there.
    const f = await fixture()
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    expect((await req(f))).toMatchObject({ state: 'deleting', committed_at: null })
    expect(await binding(f)).toMatchObject({ enabled: false, retired: true })
    expect(await refused(withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null }))).toEqual({ code: 'deletion_in_progress', status: 409 })
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Not legitimate' })
    expect((await req(f)).state).toBe('withdrawn')
    await run()
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    expect((await pool.query('SELECT status,operations_enabled FROM tenants WHERE id=$1', [f.tenant])).rows[0]).toEqual({ status: 'active', operations_enabled: true })
    expect((await steps(f)).reinstate).toMatchObject({ state: 'done' })
    expect(effects.calls.filter(c => c === 'drop_database')).toEqual([])
    // After the commit and after the deletion: 409 deletion_in_progress, for the vendor as well.
    const g = await fixture()
    await run()
    expect((await req(g)).state).toBe('deleted')
    expect(await refused(withdrawDeletion(pool, { ...who, customer_id: g.customer, by: 'vendor', reason: 'Too late' }))).toEqual({ code: 'deletion_in_progress', status: 409 })
    const h = await fixture()
    effects.failures.set('drop_database', ['database_command_failed'])
    await run()
    expect((await req(h))).toMatchObject({ state: 'deleting' })
    expect((await req(h)).committed_at).toBeInstanceOf(Date)
    expect(await refused(withdrawDeletion(pool, { ...who, customer_id: h.customer, by: 'vendor', reason: 'Too late' }))).toEqual({ code: 'deletion_in_progress', status: 409 })
    // A returning company cannot ask again for a retired workspace.
    expect(await refused(requestDeletion(pool, { ...who, customer_id: g.customer, secret: 'x'.repeat(32) }))).toEqual({ code: 'tenant_retired', status: 409 })
  })

  it('resumes exactly after a failure at each effect: a finished effect is never repeated and the failed one runs again', async () => {
    const names = ['drop_database', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'purge_offsite', 'remove_side_files']
    for (const failing of names) {
      effects = new FakeEffects()
      await pool.query('TRUNCATE tenant_deletion_steps, tenant_deletion_requests')
      const f = await fixture({ backup: true })
      effects.failures.set(failing, ['crash_injected'])
      await run()
      const ledger = await steps(f)
      expect(ledger[failing], failing).toMatchObject({ state: 'failed', error_code: 'crash_injected', failures: 1 })
      expect((await req(f)).state).toBe('deleting')
      await settle(); await run()
      expect((await req(f)).state, failing).toBe('deleted')
      const real = effects.calls.filter(c => !c.startsWith('dry:') && c !== 'remove_artifacts' && c !== 'unbind_relay')
      const expected = [...names]; expected.splice(expected.indexOf(failing), 0, failing)
      expect(real, failing).toEqual(expected)
    }
  })

  it('backs off 1 min, 5 min, 30 min, 2 h then 6 h, flags the request stuck after five failures and raises the attention item with the step and code', async () => {
    const f = await fixture()
    effects.failures.set('drop_database', Array(5).fill('database_command_failed'))
    const waits: number[] = []
    for (let i = 0; i < 5; i++) {
      await settle(); await run()
      const step = (await steps(f)).drop_database
      waits.push(Math.round((await pool.query('SELECT extract(epoch FROM (next_attempt_at - now()))::int AS s FROM tenant_deletion_steps WHERE request_id=$1 AND step=$2', [f.request, 'drop_database'])).rows[0].s / 60))
      expect(step.failures).toBe(i + 1)
    }
    expect(waits.map(w => Math.round(w / 1)).map(w => [1, 5, 30, 120, 360].find(x => Math.abs(x - w) <= 1))).toEqual([1, 5, 30, 120, 360])
    expect((await req(f)).stuck_code).toBe('drop_database:database_command_failed')
    const item = (await attention(pool, true)).items.find(i => i.kind === 'tenant_deletion_stuck' && i.customer_id === f.customer)
    expect(item).toMatchObject({ tenant_id: f.tenant, detail: 'drop_database:database_command_failed' })
    // It recovers by itself and the flag clears when the step finishes.
    await settle(); await run()
    expect(await req(f)).toMatchObject({ state: 'deleted', stuck_code: null })
  })

  it('stops a runner that lost its lease or fence: nothing is recorded for its work and the next runner resumes', async () => {
    const f = await fixture()
    // Another runner takes over in the middle of the drop: the fence moves on after the effect returned.
    effects.after = async name => { if (name === 'drop_database') await pool.query('UPDATE tenant_deletion_requests SET fence=fence+1 WHERE id=$1', [f.request]) }
    await run()
    expect((await steps(f)).drop_database).toMatchObject({ state: 'running' })
    expect((await req(f)).state).toBe('deleting')
    effects.after = undefined
    // A runner whose ownership check fails before its permit never reaches the effect.
    await pool.query('UPDATE tenant_deletion_requests SET lease_until=NULL WHERE id=$1', [f.request])
    const bumpAtPermit = new FakeEffects()
    bumpAtPermit.stage = async input => { await pool.query('UPDATE tenant_deletion_requests SET fence=fence+1 WHERE id=$1', [f.request]); await input.assertOwned(); bumpAtPermit.calls.push(input.stage); return {} }
    await run({ effects: bumpAtPermit })
    expect(bumpAtPermit.calls).toEqual([])
    await pool.query('UPDATE tenant_deletion_requests SET lease_until=NULL WHERE id=$1', [f.request])
    await settle(); await run()
    expect((await req(f)).state).toBe('deleted')
  })

  it('refuses to run a plan whose digest no longer matches, and a commit when the registry binding differs from the plan', async () => {
    const tampered = await fixture()
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    await pool.query("UPDATE tenant_deletion_requests SET plan=jsonb_set(plan,'{effect,database}','\"liwan_other\"') WHERE id=$1", [tampered.request])
    await settle(); await run()
    expect((await req(tampered)).stuck_code).toBe('preflight:plan_digest_mismatch')
    expect(effects.calls.filter(c => c === 'drop_database')).toEqual([])
    expect((await req(tampered)).committed_at).toBeNull()
    // The digest the effect receives is the canonical SHA-256 of the effect plan alone.
    expect(planDigestOf({ b: 1, a: ['x', 'é'] })).toBe(planDigestOf(JSON.parse('{"a":["x","é"],"b":1}')))
    expect(canonicalJson({ b: 1, a: [true, 'x'] })).toBe('{"a":[true,"x"],"b":1}')
    // A binding re-enabled behind the runner's back stops the commit.
    effects = new FakeEffects()
    const g = await fixture()
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    await pool.query('ALTER TABLE shared_registry_bindings DISABLE TRIGGER shared_registry_identity')
    try { await pool.query('UPDATE shared_registry_bindings SET enabled=true,retired=false WHERE control_tenant_id=$1', [g.tenant]) }
    finally { await pool.query('ALTER TABLE shared_registry_bindings ENABLE TRIGGER shared_registry_identity') }
    await settle(); await run()
    expect((await steps(g)).commit).toMatchObject({ state: 'failed', error_code: 'binding_changed' })
    expect((await req(g)).committed_at).toBeNull()
  })

  it('checks the deletion authority inside the registry publication: only the frozen digest, the right state and the exact mutation', async () => {
    const f = await fixture()
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    const row = await req(f)
    const mutation = (over: Record<string, unknown>) => ({ controlTenantId: f.tenant, expectedSnapshotRevision: 0, reason: 'authority test',
      target: { host: `${f.slug}.test`, tenantId: f.slug, database: f.database, filestore: f.database, enabled: false, retired: true, registryRevision: 3, ...over } })
    const revision = async () => (await pool.query('SELECT revision::float8 AS r FROM shared_registry_state')).rows[0].r as number
    const publish = async (digest: string, mode: 'retire' | 'reinstate', target: Record<string, unknown> = {}) =>
      refused(publishRegistryMutation(pool, registryPath, tenantDeletionActor(config, { requestId: f.request, planDigest: digest, mode }), { ...mutation({}), expectedSnapshotRevision: await revision(), target: { ...mutation({}).target, ...target } }))
    expect(await publish('0'.repeat(64), 'retire')).toMatchObject({ code: 'registry_forbidden' })
    expect(await publish(row.plan_digest, 'reinstate', { enabled: true, retired: false })).toMatchObject({ code: 'registry_forbidden' })
    expect(await publish(row.plan_digest, 'retire', { enabled: true, retired: false })).toMatchObject({ code: 'registry_forbidden' })
    // Withdrawn: the retire authority is gone, the reinstate authority exists.
    await pool.query("UPDATE tenant_deletion_requests SET state='withdrawn',withdrawn_at=now(),withdrawn_by='vendor',withdrawn_actor='x' WHERE id=$1", [f.request])
    expect(await publish(row.plan_digest, 'retire', { registryRevision: 4 })).toMatchObject({ code: 'registry_forbidden' })
    // An ordinary actor with no grant cannot publish a retired target either.
    expect(await refused(publishRegistryMutation(pool, registryPath, { issuer: 'someone', actorUid: 99 }, { ...mutation({}), expectedSnapshotRevision: await revision() }))).toMatchObject({ code: 'registry_forbidden' })
  })

  it('refuses new shared jobs, restore approvals and restore publications for a deleting tenant, and keeps backup records permanent', async () => {
    const f = await fixture({ backup: true })
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    const job = () => pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,'{}',$4,'x',1,'test')", [randomUUID(), f.tenant, randomUUID(), 'b'.repeat(64)])
    await expect(job()).rejects.toThrow('tenant_retiring')
    await expect(pool.query("INSERT INTO shared_restore_approvals(id,backup_id,control_tenant_id,target_database,reason,expires_at) VALUES($1,$2,$3,$4,'x',now() + interval '1 hour')", [randomUUID(), f.backup, f.tenant, `liwan_scratch_${'a'.repeat(32)}`])).rejects.toThrow('tenant_retiring')
    // Before the commit a backup record cannot be purged; deleting it is never allowed.
    await expect(pool.query("UPDATE shared_backups SET purged_at=now(),artifact_path=NULL,snapshot='{}' WHERE id=$1", [f.backup])).rejects.toThrow('append only')
    await expect(pool.query('DELETE FROM shared_backups WHERE id=$1', [f.backup])).rejects.toThrow('permanent')
    // Other tenants are not affected.
    const other = await fixture()
    await expect(pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,'{}',$4,'x',1,'test')", [randomUUID(), other.tenant, randomUUID(), 'b'.repeat(64)])).resolves.toBeTruthy()
  })

  it('defers for a payment in flight, a payment after due, a shared job and a pending restore, and alerts the vendor for money', async () => {
    const f = await fixture()
    const seed = async (status: string, extra = '') => {
      const c = await pool.connect()
      try {
        await c.query('SET session_replication_role = replica')
        const order = randomUUID()
        await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,currency,exponent,due_now_minor,request_digest,idempotency_key)
          VALUES($1,$2,$3,'renewal',$3,$3,'paid','applied','SAR',2,100,$4,$5)`, [order, f.customer, randomUUID(), 'c'.repeat(64), randomUUID()])
        await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,kind,status${extra ? ',succeeded_at' : ''}) VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,'hosted_invoice',$4${extra ? ',now()' : ''})`, [randomUUID(), order, randomUUID(), status])
        return order
      } finally { await c.query('SET session_replication_role = DEFAULT'); c.release() }
    }
    const state = async () => (await steps(f)).preflight
    await seed('pending')
    await run()
    expect((await req(f)).state).toBe('due')
    expect(await state()).toMatchObject({ state: 'pending', error_code: 'no_payment_in_flight' })
    expect((await req(f)).stuck_code).toBeNull()
    await pool.query("UPDATE payment_attempts SET status='failed'")
    const paid = await seed('succeeded', 'after')
    await settle(); await run()
    expect(await state()).toMatchObject({ error_code: 'no_payment_after_due' })
    expect((await req(f)).stuck_code).toBe('preflight:no_payment_after_due')
    expect((await attention(pool, true)).items.find(i => i.kind === 'tenant_deletion_stuck' && i.customer_id === f.customer)).toMatchObject({ detail: 'preflight:no_payment_after_due' })
    expect((await req(f)).state).toBe('due')
    // The vendor refunds by hand: the deferral ends and the stuck flag clears with the next step.
    await pool.query("UPDATE orders SET payment_state='refunded' WHERE id=$1", [paid])
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state) VALUES($1,$2,$3,'{}',$4,'x',1,'test','queued')", [randomUUID(), f.tenant, randomUUID(), 'b'.repeat(64)])
    await settle(); await run()
    expect(await state()).toMatchObject({ error_code: 'no_shared_job' })
    await pool.query("UPDATE shared_jobs SET state='verified',receipt='{}' WHERE control_tenant_id=$1", [f.tenant]).catch(() => undefined)
  })

  it('does not delete without a delivered due notice, and alerts after 24 hours of waiting', async () => {
    const f = await fixture({ dueNotice: false })
    await run()
    expect((await req(f)).state).toBe('due')
    expect((await steps(f)).preflight).toMatchObject({ error_code: 'due_notice_delivered' })
    expect((await req(f)).stuck_code).toBeNull()
    await pool.query("UPDATE tenant_deletion_steps SET started_at=now() - interval '25 hours' WHERE request_id=$1", [f.request])
    await settle(); await run()
    expect((await req(f)).stuck_code).toBe('preflight:due_notice_delivered')
    expect(effects.calls).toEqual([])
  })

  it('serializes a withdrawal and the commit: exactly one wins and the loser sees the other', async () => {
    for (let i = 0; i < 4; i++) {
      effects = new FakeEffects()
      const f = await fixture()
      // Run to the commit boundary: the relay step fails once so the request waits as `deleting` before the commit.
      effects.failures.set('unbind_relay', ['relay_down'])
      await run()
      await settle()
      const holder = await pool.connect()
      await holder.query('BEGIN')
      await holder.query("SELECT pg_advisory_xact_lock(hashtextextended('tenant-deletion:' || $1::text, 0))", [f.customer])
      const runner = run(); const withdrawal = refused(withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Race' }))
      await new Promise(resolve => setTimeout(resolve, 150))
      await holder.query('COMMIT'); holder.release()
      const refusal = await withdrawal
      await runner
      const row = await req(f)
      if (refusal) { expect(refusal).toEqual({ code: 'deletion_in_progress', status: 409 }); expect(row.committed_at).toBeInstanceOf(Date) }
      else { expect(row.state).toBe('withdrawn'); expect(row.committed_at).toBeNull(); expect(effects.calls).not.toContain('drop_database') }
    }
  })

  it('queues a restore against the preflight: the preflight sees the committed job, and one queued after `deleting` is refused', async () => {
    const f = await fixture()
    const writer = await pool.connect()
    await writer.query('BEGIN')
    await lockTenantJobs(writer, f.tenant)
    await writer.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason) VALUES($1,$2,$3,'{}',$4,'x',1,'queued before')", [randomUUID(), f.tenant, randomUUID(), 'b'.repeat(64)])
    const runner = run()
    await new Promise(resolve => setTimeout(resolve, 150))
    await writer.query('COMMIT'); writer.release()
    await runner
    expect((await req(f)).state).toBe('due')
    expect((await steps(f)).preflight).toMatchObject({ error_code: 'no_shared_job' })
    expect(effects.calls).toEqual([])
    // Withdrawn requests and requests with no clock do not stop other tenants' operations.
    expect((await pool.query(`SELECT ${deletionClockRunningSql('$1')} AS running`, [randomUUID()])).rows[0].running).toBe(false)
  })

  it('takes the stop-access, the guard and the status push out of reach of a retired tenant, and asks for no new request', async () => {
    const f = await fixture()
    effects.failures.set('unbind_relay', ['relay_down'])
    await run()
    expect((await pool.query(`SELECT ${deletionClockRunningSql('$1')} AS running`, [f.customer])).rows[0].running).toBe(true)
    // The status push never selects it (its binding is disabled and retired) and the tenant row is deleting.
    expect((await pool.query("SELECT 1 FROM tenants WHERE id=$1 AND status='deleting' AND operations_enabled=false", [f.tenant])).rowCount).toBe(1)
    const customerView = await tenantDeletionRunOf(pool, f.customer, true)
    expect(customerView!.request.state).toBe('deleting')
    expect(customerView!.prechecks.checks.map(c => c.code)).toContain('no_shared_job')
  })

  it('drives the real effect runner through the permit and heartbeat protocol and stops it when ownership is lost', async () => {
    const effectPlan = { schemaVersion: 1 as const, requestId: randomUUID(), controlTenantId: randomUUID(), tenantId: 'tenant_a', database: 'liwan_a', filestore: 'liwan_a', host: 'a.test', customerName: 'A', controlPlaneDatabase: 'cp', restoreCopies: [], backupIds: [] }
    const runtime = { schemaVersion: 1 as const, projectName: 'liwan-shared-test', composeFile: '/x/compose.yml', envFile: '/x/.env', stateDir: '/x/state', domainSuffix: 'example.test', releaseBackupConfig: '/x/backup.json' }
    function child(script: (request: any, write: (line: unknown) => void, nextLine: () => Promise<string>) => Promise<void>) {
      const stdin = new PassThrough(), stdout = new PassThrough(), emitter = new EventEmitter()
      const proc: any = Object.assign(emitter, { stdin, stdout, kill: () => { setImmediate(() => emitter.emit('close', 143)); return true } })
      const lines: string[] = []; let waiting: ((l: string) => void) | undefined; let buffer = ''
      stdin.on('data', chunk => { buffer += String(chunk); let i; while ((i = buffer.indexOf('\n')) >= 0) { const l = buffer.slice(0, i); buffer = buffer.slice(i + 1); if (waiting) { const w = waiting; waiting = undefined; w(l) } else lines.push(l) } })
      const nextLine = () => new Promise<string>(resolve => { const l = lines.shift(); if (l !== undefined) resolve(l); else waiting = resolve })
      void (async () => { const request = JSON.parse(await nextLine()); await script(request, line => stdout.write(JSON.stringify(line) + '\n'), nextLine); emitter.emit('close', 0) })()
      return proc
    }
    const seen: any[] = []
    const spawnChild = ((_cmd: string, _args: string[], _opts: unknown) => child(async (request, write, nextLine) => {
      seen.push(request)
      write({ permit: 'drop-database' })
      if (JSON.parse(await nextLine()).proceed !== true) throw new Error('no proceed')
      write({ result: { state: 'dropped' } })
    })) as any
    const real = createDeletionEffects(config, runtime as any, new AbortController().signal, { spawnChild })
    let permits = 0
    const out = await real.stage({ stage: 'drop_database', plan: effectPlan, planDigest: planDigestOf(effectPlan), dryRun: false, assertOwned: async () => { permits++ } })
    expect(out).toEqual({ state: 'dropped' })
    expect(permits).toBe(1)
    // The child receives exactly the effect's plan and runtime keys, and never the release backup path.
    expect(seen[0]).toMatchObject({ action: 'drop_database', dryRun: false, planDigest: planDigestOf(effectPlan) })
    expect(Object.keys(seen[0].config).sort()).toEqual(['composeFile', 'domainSuffix', 'envFile', 'projectName', 'schemaVersion', 'stateDir'])
    // Ownership lost at the permit: the effect gets no `proceed` and the stage fails with the code.
    const denied = await refused(real.stage({ stage: 'drop_database', plan: effectPlan, planDigest: planDigestOf(effectPlan), dryRun: false, assertOwned: async () => { throw new Error('deletion_lease_lost') } }))
    expect(denied).toMatchObject({ code: 'deletion_lease_lost' })
    // A digest that does not match the plan never leaves the control plane.
    expect(await refused(Promise.resolve().then(() => real.stage({ stage: 'verify', plan: effectPlan, planDigest: '0'.repeat(64), dryRun: true, assertOwned: async () => {} })))).toMatchObject({ code: 'plan_digest_mismatch' })
    // Without the relay address and token the step reports it and is skipped.
    expect(await real.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} })).toEqual({ state: 'not_configured' })
    // With them it calls the relay's purge route with the relay token, by tenant id, and reports the count only.
    const calls: { method?: string; url?: string; token?: string | string[] }[] = []
    let answer = { status: 200, body: '{"removed":2}' }
    const relay = http.createServer((request, response) => { calls.push({ method: request.method, url: request.url, token: request.headers['x-liwan-proxy-token'] }); response.writeHead(answer.status); response.end(answer.body) })
    await new Promise<void>(resolve => relay.listen(0, '127.0.0.1', resolve))
    try {
      const token = 'relay-test-token-'.repeat(3)
      const env = { LIWAN_TIKTOK_RELAY_URL: `http://127.0.0.1:${(relay.address() as AddressInfo).port}/`, LIWAN_TIKTOK_RELAY_TOKEN: token }
      const wired = createDeletionEffects(config, runtime as any, new AbortController().signal, { spawnChild, env })
      expect(await wired.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} })).toEqual({ state: 'unbound' })
      expect(calls).toEqual([{ method: 'DELETE', url: '/internal/tiktok/tenants/tenant_a', token }])
      answer = { status: 200, body: '{"removed":0}' }
      expect(await wired.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} })).toEqual({ state: 'absent' })
      answer = { status: 403, body: 'invalid_proxy_token' }
      expect(await refused(wired.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} }))).toMatchObject({ code: 'relay_purge_failed' })
      answer = { status: 200, body: 'not json' }
      expect(await refused(wired.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} }))).toMatchObject({ code: 'relay_purge_failed' })
      // Ownership lost: nothing is sent.
      const sent = calls.length
      expect(await refused(wired.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => { throw new Error('deletion_lease_lost') } }))).toMatchObject({ code: 'deletion_lease_lost' })
      expect(calls.length).toBe(sent)
      // A half-set or malformed setting is a misconfiguration that fails the step, not a silent skip.
      for (const bad of [{ LIWAN_TIKTOK_RELAY_URL: env.LIWAN_TIKTOK_RELAY_URL }, { ...env, LIWAN_TIKTOK_RELAY_TOKEN: 'short' }, { ...env, LIWAN_TIKTOK_RELAY_URL: 'ftp://relay.invalid' }]) {
        const broken = createDeletionEffects(config, runtime as any, new AbortController().signal, { spawnChild, env: bad })
        expect(await refused(broken.unbindRelay({ tenantId: 'tenant_a', assertOwned: async () => {} }))).toMatchObject({ code: 'relay_settings_invalid' })
      }
    } finally { await new Promise(resolve => relay.close(resolve)) }
  })

  it('states the dates and the hold end in the notices, and says what is deleted, kept and left to the customer', () => {
    const context = { name: 'Acme', due_on: '2027-02-10', final_at: '2027-02-13 09:00', renewal_outcome: 'cancelled', renewal_refusal: null }
    const due = tenantDeletionNotice({ type: 'due', request_id: 'r' }, context, 0).text
    expect(due).toContain('2027-02-13 09:00')
    expect(due).toContain('72')
    const confirmed = tenantDeletionNotice({ type: 'confirmed', request_id: 'r' }, context, 90).text
    expect(confirmed).toContain('2027-02-10'); expect(confirmed).toContain('2027-02-13 09:00')
    const deleted = tenantDeletionNotice({ type: 'deleted', request_id: 'r' }, context, 0).text
    expect(deleted).toContain('النسخ الاحتياطية'); expect(deleted).toContain('backups')
    expect(deleted).toContain('webhook'); expect(deleted).toContain('TikTok')
    for (const type of ['confirmed', 'reminder', 'due', 'last_call', 'deleting', 'deleted', 'withdrawn'] as const)
      expect(tenantDeletionNotice({ type, request_id: 'r' }, context, 5).text, type).not.toMatch(/nothing (is|will be) deleted|no longer withdraw(n)? a due/i)
  })

  it('marks a request due with a 72 hour hold on the database clock', async () => {
    const f = await fixture()
    await pool.query("UPDATE tenant_deletion_requests SET state='confirmed',due_marked_at=NULL,hold_until=NULL,due_at=now() - interval '1 minute' WHERE id=$1", [f.request])
    expect(await markDueDeletions(pool)).toBe(1)
    const row = await req(f)
    expect(row.state).toBe('due')
    expect((await pool.query("SELECT (hold_until = due_marked_at + interval '72 hours') AS ok FROM tenant_deletion_requests WHERE id=$1", [f.request])).rows[0].ok).toBe(true)
    expect(await run()).toBe(0)
    // A control plane restored from a backup cannot commit until the hold has passed again.
    await pool.query("UPDATE tenant_deletion_requests SET hold_until=now() - interval '1 minute' WHERE id=$1", [f.request])
    await pool.query("UPDATE control_plane_state SET restored_at=now() - interval '1 hour'")
    await run()
    expect((await steps(f)).commit).toMatchObject({ state: 'pending', error_code: 'control_plane_restored' })
    expect((await req(f)).committed_at).toBeNull()
    await pool.query('UPDATE control_plane_state SET restored_at=NULL')
    await settle(); await run()
    expect((await req(f)).state).toBe('deleted')
  })

  it('retries a card the provider will not delete, then goes on after 12 tries and tells the vendor which card', async () => {
    const f = await fixture({ card: true })
    cardFails = true
    await run()
    expect((await steps(f)).delete_cards).toMatchObject({ state: 'failed', error_code: 'card_delete_failed', failures: 1 })
    expect((await req(f)).committed_at).toBeInstanceOf(Date)
    expect(effects.calls.filter(c => c === 'drop_database')).toEqual([])
    for (let i = 0; i < 11; i++) { await settle(); await run() }
    expect((await steps(f)).delete_cards).toMatchObject({ state: 'done' })
    expect((await req(f)).stuck_code).toBe('delete_cards:card_not_deleted')
    const audit = (await pool.query("SELECT metadata FROM audit_events WHERE action='tenant_deletion.card_not_deleted' AND subject=$1", [f.customer])).rows[0].metadata
    expect(audit).toMatchObject({ brand: 'visa', last_four: '4242' })
    expect(JSON.stringify(audit)).not.toContain('tok_')
    // The deletion went on regardless.
    expect(effects.calls).toContain('drop_database')
  })
})
