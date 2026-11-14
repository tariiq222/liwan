import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { Pool } from 'pg'
import { TENANT_DELETION_HOLD_HOURS } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { url } from './commercial-helpers.js'
import { attention } from '../commercial/attention.js'
import { withdrawDeletion, requestDeletion, markDueDeletions } from '../commercial/tenant-deletion.js'
import { runTenantDeletions, queueLastCalls, tenantDeletionMode, type TenantDeletionDeps } from '../commercial/tenant-deletion-run.js'
import { sendTenantDeletionNotices, tenantDeletionNotice } from '../commercial/tenant-deletion-notices.js'
import { assertCustomerNotRetiring, tenantDeletionRunOf, deletionClockRunningSql } from '../commercial/tenant-deletion-read.js'
import { planDigestOf, canonicalJson } from '../commercial/tenant-deletion-plan.js'
import type { DeletionEffects } from '../commercial/tenant-deletion-effects.js'
import { createDeletionEffects } from '../shared/tenant-deletion-effects-runner.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { tenantDeletionActor } from '../shared/tenant-deletion-authority.js'
import { lockTenantJobs } from '../shared/job-store.js'
import { transaction } from '../db.js'
import type { PaymentAdapter } from '../commercial/payment-adapter.js'
import { removePaymentMethod } from '../commercial/payment-method-removal.js'

const suite = url ? describe : describe.skip
const config = { installationId: 'del-run', key: 'vendor-test-key-'.repeat(4), customerCommercialIssuer: 'del-customer', customerCommercialServiceKey: 'customer-test-key-'.repeat(4), inventoryPath: '', repositoryRoot: '', python: 'python3', stateDir: '' } as any
const who = { actor: 'tester', client_address: null }

/** Effects that record every call, can fail a named call once, and re-check ownership before a mutation as the real runner does at a permit. */
class FakeEffects implements DeletionEffects {
  calls: string[] = []
  failures = new Map<string, string[]>()
  after?: (name: string) => Promise<void>
  /** Holds a request in `deleting` before its commit: the first `verify` (the preflight's) is ok, the second (the commit's) is refused. */
  holdAtCommit() { this.verdicts = [{ verdict: 'ok', fenced: false, checks: { company: true, marker: 'match' } }, { verdict: 'refused', code: 'identity_marker_mismatch', fenced: false, checks: { marker: 'mismatch' } }] }
  /** Runs `fn` once, during the commit's verification (the second `dry:verify`), i.e. after the plan was frozen and access was stopped but before the commit is recorded. */
  atCommit(fn: () => Promise<void>) { let n = 0; this.after = async name => { if (name === 'dry:verify' && ++n === 2) await fn() } }
  private async hit(name: string) {
    this.calls.push(name)
    const queue = this.failures.get(name)
    if (queue?.length) throw new Error(queue.shift()!)
    await this.after?.(name)
  }
  /** The answers `verify` gives, in order; the last one repeats. */
  verdicts: Record<string, unknown>[] = []
  stage: DeletionEffects['stage'] = async input => {
    if (!input.dryRun) await input.assertOwned()
    await this.hit(input.dryRun ? `dry:${input.stage}` : input.stage)
    if (input.stage === 'verify') return (this.verdicts.length > 1 ? this.verdicts.shift() : this.verdicts[0]) ?? { verdict: 'ok', fenced: false, checks: { company: true, marker: 'match' } }
    return input.stage === 'stamp_marker' ? { state: input.dryRun ? 'would_stamp' : 'stamped', checks: { marker: 'match', company: true } } : { state: input.dryRun ? 'would' : 'done' }
  }
  purgeOffsite: DeletionEffects['purgeOffsite'] = async input => { await input.assertOwned(); await this.hit('purge_offsite'); return { state: 'empty' } }
  unbindRelay: DeletionEffects['unbindRelay'] = async () => { await this.hit('unbind_relay'); return { state: 'not_configured' } }
  removeBackupArtifacts: DeletionEffects['removeBackupArtifacts'] = async items => { await this.hit('remove_artifacts'); return { removed: items.length } }
}

suite('the final deletion of a workspace: the runner, its ledger, its guards and its notices', () => {
  const pool = new Pool({ connectionString: url, max: 12 })
  const registryDir = mkdtempSync(join(tmpdir(), 'del-registry-'))
  const registryPath = join(registryDir, 'registry.json')
  let effects: FakeEffects
  const cardCalls: string[] = []
  let cardFails = false
  const adapter = { provider: 'simulator', mode: 'simulator', deleteToken: async (token: string) => { if (cardFails) throw new Error('provider down'); cardCalls.push(token); effects.calls.push('delete_card') } } as unknown as PaymentAdapter
  const deps = (over: Partial<TenantDeletionDeps> = {}): TenantDeletionDeps => ({ pool, config, effects, enabled: true, registryPath, paymentAdapter: adapter, log: (m, e) => console.error('RUNLOG %s', m, e instanceof Error ? e.stack : e), ...over })
  const run = (over: Partial<TenantDeletionDeps> = {}) => runTenantDeletions(deps(over))
  /** Passes every backoff and deferral wait, as if the time had come. */
  const settle = () => pool.query('UPDATE tenant_deletion_steps SET next_attempt_at=NULL WHERE next_attempt_at IS NOT NULL')

  beforeAll(async () => { await migrate(pool) })
  beforeEach(async () => { effects = new FakeEffects(); cardFails = false; cardCalls.length = 0; await pool.query('TRUNCATE tenant_deletion_steps, tenant_deletion_requests'); await pool.query('TRUNCATE commercial_outbox'); await pool.query("UPDATE control_plane_state SET restored_at=NULL,deletion_enabled_since=now() - interval '10 days',marker_required_since=now() - interval '1 day'") })
  afterAll(async () => { await pool.end() })

  /** A customer with a workspace whose request is `due` and whose hold has ended `holdEnded` minutes ago (negative: still running). */
  async function fixture(opts: { holdEndedMinutes?: number; card?: boolean; backup?: boolean; dueNotice?: boolean; lastCall?: boolean } = {}) {
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
    // Both notices were really delivered, the due notice 100 hours ago and the last call 30 hours ago: more than the 72 and 24 hours the customer is owed.
    if (opts.dueNotice !== false) await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'tenant_deletion.notice',$2,$3,'{\"delivered\":true}','done',now() - interval '100 hours')", [randomUUID(), request, `due:${request}`])
    if (opts.dueNotice !== false && opts.lastCall !== false) await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'tenant_deletion.notice',$2,$3,'{\"delivered\":true}','done',now() - interval '30 hours')", [randomUUID(), request, `last_call:${request}`])
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
    expect(effects.calls.filter(c => !c.startsWith('dry:'))).toEqual(['unbind_relay', 'drop_database', 'delete_card', 'remove_filestore', 'remove_restore_copies', 'purge_local_backups', 'remove_artifacts', 'purge_offsite', 'remove_side_files'])
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
    const view = await tenantDeletionRunOf(pool, f.customer, { enabled: true, reason: null })
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
    expect(tenantDeletionMode({})).toEqual({ enabled: false, reason: 'kill_switch_off' })
    expect(tenantDeletionMode({ LIWAN_TENANT_DELETION_ENABLED: '1', LIWAN_MAIL_SMTP_HOST: 'smtp.example.com' })).toEqual({ enabled: false, reason: 'kill_switch_off' })
    // A mail accepted by a local capture host (or no mail host at all) proves no customer was warned: the runner stays in dry-run mode.
    expect(tenantDeletionMode({ LIWAN_TENANT_DELETION_ENABLED: 'true' })).toEqual({ enabled: false, reason: 'mail_host_unset' })
    for (const host of ['localhost', 'mailpit', '127.0.0.1', '::1', 'LOCALHOST']) expect(tenantDeletionMode({ LIWAN_TENANT_DELETION_ENABLED: 'true', LIWAN_MAIL_SMTP_HOST: host }), host).toEqual({ enabled: false, reason: 'local_mail_capture' })
    expect(tenantDeletionMode({ LIWAN_TENANT_DELETION_ENABLED: 'true', LIWAN_MAIL_SMTP_HOST: 'smtp.example.com' })).toEqual({ enabled: true, reason: null })
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
    // The hold ended while the switch was off: it was not served, so the first enabled pass re-arms a full hold instead of deleting (see the backlog test).
    await run({ enabled: true })
    expect((await req(f))).toMatchObject({ state: 'due', hold_notice_seq: 2 })
    expect(effects.calls.filter(c => !c.startsWith('dry:'))).toEqual([])
  })

  it('does not start before the hold ends and gives the last call once, 24 hours before it ends', async () => {
    const f = await fixture({ holdEndedMinutes: -(TENANT_DELETION_HOLD_HOURS * 60 - 60), lastCall: false })
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
    effects.holdAtCommit()
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
    effects = new FakeEffects()
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
    effects.holdAtCommit()
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
    effects.holdAtCommit()
    await run()
    await pool.query('ALTER TABLE shared_registry_bindings DISABLE TRIGGER shared_registry_identity')
    try { await pool.query('UPDATE shared_registry_bindings SET enabled=true,retired=false WHERE control_tenant_id=$1', [g.tenant]) }
    finally { await pool.query('ALTER TABLE shared_registry_bindings ENABLE TRIGGER shared_registry_identity') }
    effects.verdicts = []
    await settle(); await run()
    expect((await steps(g)).commit).toMatchObject({ state: 'failed', error_code: 'binding_changed' })
    expect((await req(g)).committed_at).toBeNull()
  })

  it('checks the deletion authority inside the registry publication: only the frozen digest, the right state and the exact mutation', async () => {
    const f = await fixture()
    effects.holdAtCommit()
    await run()
    const row = await req(f)
    const mutation = (over: Record<string, unknown>) => ({ controlTenantId: f.tenant, expectedSnapshotRevision: 0, reason: 'authority test',
      target: { host: `${f.slug}.test`, tenantId: f.slug, database: f.database, filestore: f.database, enabled: false, retired: true, registryRevision: 3, ...over } })
    const revision = async () => (await pool.query('SELECT revision::float8 AS r FROM shared_registry_state')).rows[0].r as number
    const publish = async (digest: string, mode: 'retire' | 'reinstate', target: Record<string, unknown> = {}) =>
      refused(publishRegistryMutation(pool, registryPath, tenantDeletionActor(config, { requestId: f.request, planDigest: digest, mode, enabled: mode === 'reinstate' }), { ...mutation({}), expectedSnapshotRevision: await revision(), target: { ...mutation({}).target, ...target } }))
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
    effects.holdAtCommit()
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
      effects.holdAtCommit()
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
    effects.holdAtCommit()
    await run()
    expect((await pool.query(`SELECT ${deletionClockRunningSql('$1')} AS running`, [f.customer])).rows[0].running).toBe(true)
    // The status push never selects it (its binding is disabled and retired) and the tenant row is deleting.
    expect((await pool.query("SELECT 1 FROM tenants WHERE id=$1 AND status='deleting' AND operations_enabled=false", [f.tenant])).rowCount).toBe(1)
    const customerView = await tenantDeletionRunOf(pool, f.customer, { enabled: true, reason: null })
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
    // A control plane restored from a backup: a due request whose hold ended stays due, working and withdrawable, with a fresh hold and a notice that says why.
    await pool.query("UPDATE tenant_deletion_requests SET hold_until=now() - interval '1 minute' WHERE id=$1", [f.request])
    await pool.query("UPDATE control_plane_state SET restored_at=now() - interval '1 hour'")
    await run()
    const held = await req(f)
    expect(held).toMatchObject({ state: 'due', hold_notice_seq: 2 })
    expect(held.hold_until.getTime() - Date.now()).toBeGreaterThan(70 * 3600_000)
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    expect(noDestructive()).toEqual([])
    const notice = (await pool.query("SELECT payload FROM commercial_outbox WHERE aggregate_id=$1 AND dedupe_key=$2", [f.request, `due:${f.request}:2`])).rows[0].payload
    expect(notice).toMatchObject({ type: 'due', reason: 'restore' })
    expect(tenantDeletionNotice(notice, { name: 'Acme', due_on: '2026-11-14', final_at: '2026-11-17 05:37', renewal_outcome: null, renewal_refusal: null }, 0).text).toContain('restored from a backup')
    // The vendor's run view shows the restore hold.
    expect((await tenantDeletionRunOf(pool, f.customer, { enabled: true, reason: null }))!.restore_hold_until).not.toBeNull()
    // The customer can still withdraw during it.
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'customer', reason: null })
    expect((await req(f)).state).toBe('withdrawn')
    // A request already `deleting` and not committed when the backup was taken returns to `due` with the same fresh hold, and its workspace is reinstated.
    await pool.query('UPDATE control_plane_state SET restored_at=NULL')
    effects = new FakeEffects(); effects.holdAtCommit()
    const g = await fixture()
    await run()
    expect((await req(g))).toMatchObject({ state: 'deleting', committed_at: null })
    expect(await binding(g)).toMatchObject({ enabled: false, retired: true })
    await pool.query("UPDATE control_plane_state SET restored_at=now()")
    await settle(); await run()
    expect((await req(g)).state).toBe('withdrawn')
    const fresh = (await pool.query("SELECT * FROM tenant_deletion_requests WHERE customer_id=$1 AND state='due'", [g.customer])).rows[0]
    expect(fresh.hold_until.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000)
    await run()
    expect(await binding(g)).toMatchObject({ enabled: true, retired: false })
    expect((await pool.query('SELECT status,operations_enabled FROM tenants WHERE id=$1', [g.tenant])).rows[0]).toEqual({ status: 'active', operations_enabled: true })
    expect(noDestructive()).toEqual([])
    // Once the restore hold has passed, the commit itself still refuses inside a hold (belt and braces) and the request is served normally.
    await pool.query('UPDATE control_plane_state SET restored_at=NULL')
  })

  it('retries a card the provider will not delete, then goes on after 12 tries and tells the vendor which card', async () => {
    const f = await fixture({ card: true })
    cardFails = true
    await run()
    expect((await steps(f)).delete_cards).toMatchObject({ state: 'failed', error_code: 'card_delete_failed', failures: 1 })
    expect((await req(f)).committed_at).toBeInstanceOf(Date)
    expect(effects.calls.filter(c => c === 'drop_database')).toEqual(['drop_database']) // the database goes first; the cards never precede it
    expect(effects.calls.filter(c => c === 'remove_filestore')).toEqual([])
    for (let i = 0; i < 11; i++) { await settle(); await run() }
    expect((await steps(f)).delete_cards).toMatchObject({ state: 'done' })
    expect((await req(f)).stuck_code).toBe('delete_cards:card_not_deleted')
    const audit = (await pool.query("SELECT metadata FROM audit_events WHERE action='tenant_deletion.card_not_deleted' AND subject=$1", [f.customer])).rows[0].metadata
    expect(audit).toMatchObject({ brand: 'visa', last_four: '4242' })
    expect(JSON.stringify(audit)).not.toContain('tok_')
    // The deletion went on regardless.
    expect(effects.calls).toContain('drop_database')
  })

  // ---- the review of the runner ----

  /** A payment taken for the customer's order, bypassing foreign keys and triggers as a path that does not go through the gated routes would. */
  async function seedPayment(f: Fx, status: 'succeeded' | 'pending') {
    const c = await pool.connect()
    try {
      await c.query('SET session_replication_role = replica')
      const order = randomUUID()
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,currency,exponent,due_now_minor,request_digest,idempotency_key)
        VALUES($1,$2,$3,'renewal',$3,$3,'paid','applied','SAR',2,100,$4,$5)`, [order, f.customer, randomUUID(), 'c'.repeat(64), randomUUID()])
      await c.query(`INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,kind,status${status === 'succeeded' ? ',succeeded_at' : ''}) VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,'hosted_invoice',$4${status === 'succeeded' ? ',now()' : ''})`, [randomUUID(), order, randomUUID(), status])
    } finally { await c.query('SET session_replication_role = DEFAULT'); c.release() }
  }
  const noDestructive = () => effects.calls.filter(c => !c.startsWith('dry:') && c !== 'unbind_relay')

  it('proves the identity before access is stopped and again before the commit: a refusal defers with its code and the request stays withdrawable', async () => {
    const f = await fixture({ card: true })
    effects.verdicts = [{ verdict: 'refused', code: 'identity_marker_mismatch', fenced: false, checks: { marker: 'mismatch' } }]
    await run()
    expect(await req(f)).toMatchObject({ state: 'due', stuck_code: 'preflight:identity_marker_mismatch' })
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    expect((await steps(f)).preflight).toMatchObject({ state: 'pending', error_code: 'identity_marker_mismatch' })
    expect(noDestructive()).toEqual([])
    // A database already gone is not acceptable before the commit.
    effects = new FakeEffects(); effects.verdicts = [{ verdict: 'absent' }]
    await settle(); await run()
    expect((await steps(f)).preflight).toMatchObject({ error_code: 'database_absent' })
    // A tenant created AFTER the marker requirement with no marker is a refusal for an operator: nothing is written.
    const marker = { verdict: 'refused', code: 'identity_marker_missing', fenced: false, checks: { marker: 'missing' } }
    effects = new FakeEffects(); effects.verdicts = [marker]
    await settle(); await run()
    expect((await steps(f)).preflight).toMatchObject({ error_code: 'marker_missing_needs_operator' })
    expect((await req(f)).stuck_code).toBe('preflight:marker_missing_needs_operator')
    expect(effects.calls.filter(c => c.includes('stamp_marker'))).toEqual([])
    expect((await pool.query("SELECT 1 FROM audit_events WHERE action='tenant_deletion.marker_stamped' AND subject=$1", [f.customer])).rowCount).toBe(0)
    // A tenant created BEFORE it is stamped once (a dry run, then for real), audited with its database, the digest and the effect's checks, then verified again.
    await pool.query("UPDATE control_plane_state SET marker_required_since = now() + interval '1 day'")
    effects = new FakeEffects(); effects.verdicts = [{ verdict: 'refused', code: 'identity_marker_missing', fenced: false, checks: { marker: 'missing' } }, { verdict: 'ok', fenced: false, checks: { company: true, marker: 'match' } }]
    await settle(); await run()
    expect(effects.calls.filter(c => c.includes('stamp_marker'))).toEqual(['dry:stamp_marker', 'stamp_marker'])
    expect((await req(f)).state).toBe('deleted')
    const stamped = (await pool.query("SELECT metadata FROM audit_events WHERE action='tenant_deletion.marker_stamped' AND subject=$1", [f.customer])).rows
    expect(stamped).toHaveLength(1)
    expect(stamped[0].metadata).toMatchObject({ database: f.database, state: 'stamped', checks: { marker: 'match' } })
    expect(stamped[0].metadata.plan_digest).toMatch(/^[0-9a-f]{64}$/)
    expect((await steps(f)).preflight.evidence.stamped).toMatchObject({ state: 'stamped' })
  })

  it('refuses the commit when the second verification or a dry run of any destructive stage refuses, before a card is deleted', async () => {
    const f = await fixture({ card: true })
    effects.verdicts = [{ verdict: 'ok', fenced: false, checks: { company: true, marker: 'match' } }, { verdict: 'refused', code: 'identity_base_url_mismatch', fenced: false, checks: {} }]
    await run()
    expect(await req(f)).toMatchObject({ state: 'deleting', committed_at: null, stuck_code: 'commit:identity_base_url_mismatch' })
    expect(cardCalls).toEqual([]); expect(noDestructive()).toEqual([])
    // A destructive stage that would be refused (a restore copy of another tenant) also stops the commit.
    effects = new FakeEffects()
    effects.after = async name => { if (name === 'dry:verify') effects.failures.set('dry:remove_restore_copies', ['restore_copy_marker_mismatch']) }
    await settle(); await run()
    expect((await steps(f)).commit).toMatchObject({ state: 'pending', error_code: 'restore_copy_marker_mismatch' })
    expect((await req(f)).committed_at).toBeNull()
    // Still withdrawable by the vendor; the workspace comes back.
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Identity refused' })
    await run()
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    expect(cardCalls).toEqual([])
  })

  it('does not block a deletion because the company was renamed when the marker matches', async () => {
    const f = await fixture()
    await pool.query("UPDATE customers SET name='Renamed Company' WHERE id=$1", [f.customer])
    effects.verdicts = [{ verdict: 'ok', fenced: false, checks: { company: false, marker: 'match', baseUrl: true, baseUrlFrozen: true, profileCount: 1, profile: true } }]
    await run()
    expect((await req(f)).state).toBe('deleted')
  })

  it('re-derives the plan at the commit: a card and a backup created after the preflight are deleted too, a payment after it defers, any other change defers', async () => {
    const f = await fixture({ card: true, backup: true })
    let late = ''
    effects.atCommit(async () => {
      late = randomUUID()
      // A path that does not come through the gated routes (the database trigger is switched off to model one).
      await pool.query('ALTER TABLE payment_methods DISABLE TRIGGER payment_methods_customer_retiring')
      try { await pool.query(`INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,status,is_default,consent_at,consent_text_version,created_by)
        VALUES($1,$2,'simulator','simulator',$3,'mada','1111',12,2030,'active',false,now(),'v1','test')`, [late, f.customer, `tok_${late}`]) }
      finally { await pool.query('ALTER TABLE payment_methods ENABLE TRIGGER payment_methods_customer_retiring') }
      await pool.query(`INSERT INTO shared_backups(id,control_tenant_id,tenant_id,database_name,filestore,snapshot,database_sha256,filestore_sha256,artifact_path,consistency,created_by)
        VALUES($1,$2,$3,$4,$4,'{"schemaVersion":1}',$5,$5,$6,'verified','test')`, [randomUUID(), f.tenant, f.slug, f.database, 'b'.repeat(64), `/tmp/late-${late}.json`])
    })
    await run()
    // The commit saw the plan change under it and deferred; the next attempt re-derives and re-freezes it.
    expect((await req(f)).state).toBe('deleting')
    await settle(); await run()
    expect((await req(f)).state).toBe('deleted')
    expect(cardCalls).toEqual(expect.arrayContaining([`tok_${f.card}`, `tok_${late}`]))
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_backups WHERE control_tenant_id=$1 AND purged_at IS NOT NULL', [f.tenant])).rows[0].n).toBe(2)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE subject=$1 AND action='tenant_deletion.plan_refrozen'", [f.customer])).rows[0].n).toBe(1)
    // A payment taken after the preflight defers the commit and alerts the vendor; nothing is deleted.
    effects = new FakeEffects()
    const g = await fixture()
    effects.atCommit(() => seedPayment(g, 'succeeded'))
    await run()
    expect(await req(g)).toMatchObject({ state: 'deleting', committed_at: null, stuck_code: 'commit:no_payment_after_due' })
    expect(noDestructive()).toEqual([])
    // Any other difference from the plan (the company's name here) defers as a changed plan.
    effects = new FakeEffects()
    const h = await fixture()
    effects.atCommit(async () => { await pool.query("UPDATE customers SET name='Another name' WHERE id=$1", [h.customer]) })
    await run()
    await settle(); await run()
    expect(await req(h)).toMatchObject({ state: 'deleting', committed_at: null, stuck_code: 'commit:plan_changed' })
  })

  it('refuses every creation for a deleting customer in the database and answers `tenant_retiring` to the customer routes, while a card removal still passes', async () => {
    const f = await fixture({ card: true })
    effects.holdAtCommit()
    await run()
    expect((await req(f)).state).toBe('deleting')
    const order = () => pool.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,currency,exponent,due_now_minor,request_digest,idempotency_key)
      VALUES($1,$2,$3,'new',$3,$3,'awaiting_payment','not_started','SAR',2,100,$4,$5)`, [randomUUID(), f.customer, randomUUID(), 'c'.repeat(64), randomUUID()])
    await expect(order()).rejects.toThrow('tenant_retiring')
    await expect(pool.query(`INSERT INTO payment_methods(id,customer_id,provider,mode,provider_token,brand,last_four,exp_month,exp_year,status,is_default,consent_at,consent_text_version,created_by)
      VALUES($1,$2,'simulator','simulator','t','visa','4242',12,2030,'active',false,now(),'v1','test')`, [randomUUID(), f.customer])).rejects.toThrow('tenant_retiring')
    await expect(pool.query("INSERT INTO ai_topups(id,customer_id,order_id,amount_minor,currency,usd_rate,units) VALUES($1,$2,$1,100,'SAR',1,1)", [randomUUID(), f.customer])).rejects.toThrow('tenant_retiring')
    await expect(pool.query('UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=now(),revision=revision+1 WHERE customer_id=$1', [f.customer])).rejects.toThrow('tenant_retiring')
    const c = await pool.connect()
    try {
      await c.query('SET session_replication_role = replica')
      const o = randomUUID()
      await c.query(`INSERT INTO orders(id,customer_id,subscription_id,kind,quote_id,target_revision_id,payment_state,fulfillment_state,currency,exponent,due_now_minor,request_digest,idempotency_key)
        VALUES($1,$2,$3,'renewal',$3,$3,'awaiting_payment','not_started','SAR',2,100,$4,$5)`, [o, f.customer, randomUUID(), 'c'.repeat(64), randomUUID()])
      await c.query('SET session_replication_role = DEFAULT')
      await expect(pool.query("INSERT INTO payment_attempts(id,order_id,invoice_id,provider,mode,amount_minor,currency,exponent,kind) VALUES($1,$2,$3,'simulator','simulator',100,'SAR',2,'hosted_invoice')", [randomUUID(), o, randomUUID()])).rejects.toThrow('tenant_retiring')
    } finally { c.release() }
    // Another customer is not affected.
    const other = await fixture()
    await expect(pool.query("UPDATE subscriptions SET auto_renew_enabled=true,auto_renew_consent_at=now(),revision=revision+1 WHERE customer_id=$1", [other.customer])).resolves.toBeTruthy()
    expect(await refused(assertCustomerNotRetiring(pool, f.customer))).toEqual({ code: 'tenant_retiring', status: 409 })
    expect(await refused(assertCustomerNotRetiring(pool, other.customer))).toBeNull()
  })

  it('lists a withdrawn request whose reinstatement keeps failing, so a customer who withdrew in time is never left offline silently, and clears it when it succeeds', async () => {
    const f = await fixture()
    effects.holdAtCommit()
    await run()
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Mistake' })
    await run({ registryPath: join(registryDir, 'missing-dir', 'registry.json') })
    expect((await steps(f)).reinstate).toMatchObject({ state: 'failed', failures: 1 })
    expect(await binding(f)).toMatchObject({ enabled: false, retired: true })
    const listed = async () => (await attention(pool, true)).items.find(i => i.kind === 'tenant_deletion_stuck' && i.customer_id === f.customer)
    expect(await listed()).toBeUndefined() // fresh: not yet a quarter of an hour
    await pool.query("UPDATE tenant_deletion_requests SET withdrawn_at=now() - interval '20 minutes' WHERE id=$1", [f.request])
    expect(await listed()).toMatchObject({ detail: 'reinstate:step_failed', tenant_id: f.tenant })
    await settle(); await run()
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    expect(await listed()).toBeUndefined()
  })

  it('reinstates exactly the state the tenant had: a tenant the vendor disabled, or one needing intervention, does not come back active', async () => {
    const f = await fixture()
    await pool.query("UPDATE tenants SET operations_enabled=false,status='needs_intervention' WHERE id=$1", [f.tenant])
    await pool.query('ALTER TABLE shared_registry_bindings DISABLE TRIGGER shared_registry_identity')
    try { await pool.query('UPDATE shared_registry_bindings SET enabled=false,registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [f.tenant]) }
    finally { await pool.query('ALTER TABLE shared_registry_bindings ENABLE TRIGGER shared_registry_identity') }
    effects.holdAtCommit()
    await run()
    expect(await binding(f)).toMatchObject({ enabled: false, retired: true })
    expect((await steps(f)).stop_access.evidence.prior).toEqual({ registry_enabled: false, operations_enabled: false, tenant_status: 'needs_intervention' })
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Back' })
    await run()
    expect(await binding(f)).toMatchObject({ enabled: false, retired: false })
    expect((await pool.query('SELECT status,operations_enabled FROM tenants WHERE id=$1', [f.tenant])).rows[0]).toEqual({ status: 'needs_intervention', operations_enabled: false })
    // The ordinary case: vendor-disabled operations on an active tenant stay disabled; an enabled route is enabled again.
    effects = new FakeEffects()
    const g = await fixture()
    await pool.query('UPDATE tenants SET operations_enabled=false WHERE id=$1', [g.tenant])
    effects.holdAtCommit()
    await run()
    await withdrawDeletion(pool, { ...who, customer_id: g.customer, by: 'vendor', reason: 'Back' })
    await run()
    expect(await binding(g)).toMatchObject({ enabled: true, retired: false })
    expect((await pool.query('SELECT status,operations_enabled FROM tenants WHERE id=$1', [g.tenant])).rows[0]).toEqual({ status: 'active', operations_enabled: false })
  })

  it('does not delete a backlog when the switch is turned on: every hold that ended while it was off is re-armed with a new due notice, and a hold served with the switch on proceeds', async () => {
    await pool.query('UPDATE control_plane_state SET deletion_enabled_since=NULL')
    const a = await fixture({ holdEndedMinutes: 600 }), b = await fixture({ holdEndedMinutes: 6000 })
    await run({ enabled: false })
    expect(effects.calls.every(c => c.startsWith('dry:'))).toBe(true)
    await run({ enabled: true })
    for (const f of [a, b]) {
      const row = await req(f)
      expect(row).toMatchObject({ state: 'due', hold_notice_seq: 2 })
      expect(row.hold_until.getTime() - Date.now()).toBeGreaterThan(71 * 3600_000)
      expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND dedupe_key=$2", [f.request, `due:${f.request}:2`])).rowCount).toBe(1)
    }
    expect(noDestructive()).toEqual([])
    // Re-armed once: the next pass does not re-arm again.
    await run({ enabled: true })
    expect((await req(a)).hold_notice_seq).toBe(2)
    // A hold that ends after the switch was seen on is served: with its own notices delivered, it is deleted.
    const c = await fixture({ holdEndedMinutes: -1 })
    await pool.query("UPDATE control_plane_state SET deletion_enabled_since=now() - interval '2 hours'")
    await pool.query("UPDATE tenant_deletion_requests SET hold_until=now() - interval '1 minute' WHERE id=$1", [c.request])
    await run({ enabled: true })
    expect((await req(c)).state).toBe('deleted')
  })

  it('requires the due notice a full hold and the last call 24 hours before the commit, extends the hold when one was late and tells the customer, and ignores a notice closed as stale', async () => {
    // The due notice reached the customer one hour ago only: the hold is extended to 72 hours after it.
    const f = await fixture()
    await pool.query("UPDATE commercial_outbox SET processed_at=now() - interval '1 hour' WHERE aggregate_id=$1 AND dedupe_key=$2", [f.request, `due:${f.request}`])
    await pool.query("UPDATE commercial_outbox SET processed_at=now() - interval '1 hour' WHERE aggregate_id=$1 AND dedupe_key=$2", [f.request, `last_call:${f.request}`])
    await run()
    const row = await req(f)
    expect(row.state).toBe('due')
    expect(row.hold_until.getTime() - Date.now()).toBeGreaterThan(70 * 3600_000)
    expect((await steps(f)).preflight).toMatchObject({ error_code: 'hold_not_served' })
    expect((await pool.query("SELECT payload FROM commercial_outbox WHERE aggregate_id=$1 AND dedupe_key LIKE 'hold_extended:%'", [f.request])).rowCount).toBe(1)
    const text = tenantDeletionNotice({ type: 'hold_extended', request_id: f.request }, { name: 'Acme', due_on: '2026-11-14', final_at: '2026-11-17 05:37', renewal_outcome: null, renewal_refusal: null }, 3).text
    expect(text).toContain('2026-11-17 05:37 بتوقيت الرياض'); expect(text).toContain('2026-11-17 05:37 Riyadh time')
    // A last call that was never queued is queued and awaited, and a last call closed without delivery (stale) does not count.
    const g = await fixture({ lastCall: false })
    await run()
    expect((await steps(g)).preflight).toMatchObject({ error_code: 'last_call_delivered' })
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND dedupe_key=$2", [g.request, `last_call:${g.request}`])).rowCount).toBe(1)
    await pool.query("UPDATE commercial_outbox SET status='done',processed_at=now() - interval '40 hours' WHERE aggregate_id=$1 AND dedupe_key=$2", [g.request, `last_call:${g.request}`])
    await settle(); await run()
    expect((await steps(g)).preflight).toMatchObject({ error_code: 'last_call_delivered' })
    expect((await req(g)).state).toBe('due')
    // No last call for a hold with less than two hours left.
    const h = await fixture({ holdEndedMinutes: -90, lastCall: false })
    expect(await queueLastCalls(pool)).toBe(0)
    expect((await pool.query("SELECT 1 FROM commercial_outbox WHERE aggregate_id=$1 AND dedupe_key LIKE 'last_call:%'", [h.request])).rowCount).toBe(0)
  })

  it('does not count a final mail closed as undeliverable as delivered: the contacts go with an alert', async () => {
    const f = await fixture()
    await run()
    await pool.query("UPDATE commercial_outbox SET status='failed',processed_at=now() WHERE aggregate_id=$1 AND dedupe_key=$2", [f.request, `deleted:${f.request}`])
    await settle(); await run()
    expect((await steps(f)).anonymise_contacts).toMatchObject({ state: 'done' })
    expect((await req(f)).stuck_code).toBe('anonymise_contacts:final_mail_unsent')
    expect((await pool.query('SELECT admin_login FROM customers WHERE id=$1', [f.customer])).rows[0].admin_login).toBeNull()
  })

  it('builds the final mail from what happened: a card that could not be removed is retried by the token job and the vendor item stays until it is gone, and a skipped relay is named', async () => {
    const f = await fixture({ card: true })
    cardFails = true
    await run()
    for (let i = 0; i < 11; i++) { await settle(); await run() }
    expect((await req(f)).stuck_code).toBe('delete_cards:card_not_deleted')
    expect((await pool.query('SELECT status FROM payment_methods WHERE id=$1', [f.card])).rows[0].status).toBe('removed')
    const job = (await pool.query("SELECT status FROM commercial_outbox WHERE kind='payment_token.delete' AND aggregate_id=$1", [f.card])).rows
    expect(job).toEqual([{ status: 'pending' }])
    const mails: { to: string; text: string }[] = []
    await sendTenantDeletionNotices(pool, { mail: { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } } })
    const final = mails.find(m => m.text.includes('اكتمل') || m.text.includes('is complete'))!
    expect(final.text).toContain('تعذّر حذف بعض بطاقات الدفع'); expect(final.text).toContain('could not be deleted at the payment provider yet')
    expect(final.text).not.toContain('The saved payment cards were deleted')
    expect(final.text).toContain('TikTok accounts on our side') // the relay step was skipped as not configured
    // The vendor item stays while the token job is pending, and clears once the token is really deleted.
    await run(); expect((await req(f)).stuck_code).toBe('delete_cards:card_not_deleted')
    await pool.query("UPDATE commercial_outbox SET status='done',processed_at=now() WHERE kind='payment_token.delete' AND aggregate_id=$1", [f.card])
    await run(); expect((await req(f)).stuck_code).toBeNull()
    // A card that was removed says so.
    effects = new FakeEffects(); cardFails = false
    const g = await fixture({ card: true })
    await run()
    await sendTenantDeletionNotices(pool, { mail: { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } } })
    expect(mails.filter(m => m.to === g.login).at(-1)!.text).toContain('The saved payment cards were deleted')
  })

  it('leaves in no table, after the deletion and the anonymisation, the administrator name, email, mobile or address of a fully seeded customer except what the owner keeps', async () => {
    const f = await fixture({ card: true, backup: true })
    // Needles that cannot occur anywhere else: long random tokens embedded in each value, so no other suite's rows can match and `LIKE` cannot match a prefix of another value.
    const token = () => randomUUID().replaceAll('-', '')
    const digits = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '5')
    const group = () => `f${token().slice(0, 3)}`
    const needles = { email: `adm-${token()}@example.test`, name: `Zainab-${token()}`, mobile: `+966${digits()}${digits()}`, address: `2001:db8:${group()}:${group()}:${group()}::${group()}` }
    await pool.query('UPDATE customers SET admin_login=$2 WHERE id=$1', [f.customer, needles.email])
    await pool.query('UPDATE customers SET admin_name=$2 WHERE id=$1', [f.customer, needles.name])
    await pool.query("UPDATE tenant_deletion_requests SET requested_from=$2,confirmed_from=$2 WHERE id=$1", [f.request, needles.address])
    await pool.query(`INSERT INTO shared_onboardings(request_id,control_tenant_id,issuer,actor_uid,request_digest,admin_name,admin_login,host,tenant_slug,database_name)
      VALUES($1,$2,'i',1,$3,$4,$5,$6,$7,$8)`, [randomUUID(), f.tenant, 'd'.repeat(64), needles.name, needles.email, `${f.slug}.test`, f.slug, f.database])
    await pool.query("INSERT INTO admin_invitations(id,customer_id,tenant_id,admin_login,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now() + interval '1 day')", [randomUUID(), f.customer, f.tenant, needles.email, randomUUID()])
    await pool.query("INSERT INTO public_signups(id,company_name,admin_name,email,mobile,expires_at,sms_digest,sms_expires_at,terms_version,terms_accepted_at,terms_accepted_ip) VALUES($1,'Co',$2,$3,$4,now() + interval '1 day','\\x00',now(),'v1',now(),$5)", [randomUUID(), needles.name, needles.email, needles.mobile, needles.address])
    await pool.query('INSERT INTO public_signup_trials(customer_id,email,mobile) VALUES($1,$2,$3)', [f.customer, needles.email, needles.mobile])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status,processed_at) VALUES($1,'billing.notice',$2,'seed-1',$3::jsonb,'done',now())", [randomUUID(), f.customer, JSON.stringify({ to: needles.email, error: `550 ${needles.email} rejected`, client_address: needles.address, meta: { deep: [{ recipient: needles.email, keep: 1 }], context: { admin_login: needles.email } } })])
    await pool.query("INSERT INTO commercial_outbox(id,kind,aggregate_id,dedupe_key,payload,status) VALUES($1,'billing.notice',$2,'seed-2',$3::jsonb,'pending')", [randomUUID(), f.tenant, JSON.stringify({ to: needles.email, customer_id: f.customer })])
    for (const [subject, meta] of [[f.customer, { admin_login: needles.email, client_address: needles.address, nested: { list: [{ email: needles.email }] } }], [f.tenant, { address_hash: needles.address, error: needles.email }]] as const)
      await pool.query("INSERT INTO audit_events(id,actor,action,subject,reason,metadata) VALUES(gen_random_uuid(),'x','seed',$1,'',$2::jsonb)", [subject, JSON.stringify(meta)])
    await run()
    const mails: { to: string; subject: string; text: string }[] = []
    await sendTenantDeletionNotices(pool, { mail: { send: async (m: any) => { mails.push(m); return { accepted: true, provider_message_id: 'p' } } } })
    await settle(); await run()
    expect((await steps(f)).anonymise_contacts).toMatchObject({ state: 'done' })
    // Every column of every table (arrays and nested JSON included: the text form of the whole value is searched). A scan query that fails fails the test.
    const columns = (await pool.query(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type NOT IN ('bytea')
      AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema='public') ORDER BY 1,2`)).rows
    const patterns = Object.values(needles).map(needle => `%${needle}%`)
    const hits: string[] = []
    for (const { table_name: table, column_name: column } of columns) {
      const found = await pool.query(`SELECT 1 FROM "${table}" WHERE "${column}"::text LIKE ANY($1::text[]) LIMIT 1`, [patterns])
      if (found.rowCount) hits.push(`${table}.${column}`)
    }
    // The explicit allow-list of what stays, and why.
    const kept = [
      // The trial claim: the owner keeps it so a trial cannot be reused; its whole content is the email and the mobile.
      'public_signup_trials.email', 'public_signup_trials.mobile',
      // The deletion request is the proof that the customer asked and confirmed: it keeps the address it was asked and confirmed from.
      'tenant_deletion_requests.confirmed_from', 'tenant_deletion_requests.requested_from',
    ]
    expect([...new Set(hits)].filter(h => !kept.includes(h))).toEqual([])
    for (const h of kept) expect(hits, h).toContain(h)
  })

  it('removes only a backup artifact of this tenant that sits directly under the backup root, refuses links and paths outside, and keeps the off-site purge owned by a heartbeat', async () => {
    const { mkdirSync, writeFileSync, symlinkSync, existsSync } = await import('node:fs')
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'del-backups-'))), outside = realpathSync(mkdtempSync(join(tmpdir(), 'del-outside-')))
    const runtime = { schemaVersion: 1 as const, projectName: 'liwan-shared-test', composeFile: '/x/c.yml', envFile: '/x/.env', stateDir: '/x/state', domainSuffix: 'example.test' }
    const real = createDeletionEffects(config, runtime as any, new AbortController().signal, { backupRoot: root })
    const id = randomUUID(), other = randomUUID()
    writeFileSync(join(root, `${id}.json`), '{}'); mkdirSync(join(root, other)); writeFileSync(join(root, other, 'part'), 'x')
    expect(await real.removeBackupArtifacts([{ id, path: join(root, `${id}.json`) }, { id: other, path: join(root, other) }])).toEqual({ removed: 2 })
    expect(existsSync(join(root, `${id}.json`))).toBe(false); expect(existsSync(join(root, other))).toBe(false)
    // Outside the root, another name, a link: each refuses the whole call and removes nothing.
    writeFileSync(join(outside, 'precious'), 'keep')
    const victim = randomUUID()
    symlinkSync(outside, join(root, `${victim}.json`))
    for (const bad of [{ id: victim, path: join(outside, 'precious') }, { id: victim, path: join(root, 'other-name.json') }, { id: victim, path: join(root, `${victim}.json`) }, { id: 'not-a-uuid', path: join(root, 'not-a-uuid.json') }])
      expect(await refused(real.removeBackupArtifacts([bad])), JSON.stringify(bad)).toMatchObject({ code: 'artifact_path_invalid' })
    expect(existsSync(join(outside, 'precious'))).toBe(true)
    // A row of another tenant is never named: the runner selects by the plan's ids AND the plan's control tenant.
    const f = await fixture({ backup: true })
    const foreign = await fixture({ backup: true })
    await pool.query('UPDATE tenant_deletion_requests SET state=state WHERE id=$1', [f.request])
    const plan = (await pool.query("SELECT 1 FROM shared_backups WHERE id=$1 AND control_tenant_id=$2", [foreign.backup, f.tenant])).rowCount
    expect(plan).toBe(0)
    // The off-site purge re-checks ownership on a heartbeat and is stopped when it is lost.
    let checks = 0
    const slow = ((_cmd: string, _args: string[]) => {
      const emitter = new EventEmitter(), stdout = new PassThrough()
      return Object.assign(emitter, { stdout, kill: () => { setImmediate(() => emitter.emit('close', 143)); return true } })
    }) as any
    const effectsHeartbeat = createDeletionEffects(config, runtime as any, new AbortController().signal, { spawnChild: slow, heartbeatMs: 20 })
    const lost = await refused(effectsHeartbeat.purgeOffsite({ tenantId: 'tenant_a', settleSeconds: 1, assertOwned: async () => { checks++; if (checks > 2) throw new Error('lease') } }))
    expect(lost).toMatchObject({ code: 'deletion_lease_lost' })
    expect(checks).toBeGreaterThan(2)
  })

  it('stops quietly when a withdrawal lands between the relay call and the write that follows, keeps a commit already recorded in place, and leaves the tombstone of a deleted tenant', async () => {
    const f = await fixture()
    effects.atCommit(() => withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Late' }))
    await run()
    expect((await steps(f)).commit).toMatchObject({ state: 'running' })
    expect((await req(f)).state).toBe('withdrawn')
    effects.after = undefined
    await run()
    expect(await binding(f)).toMatchObject({ enabled: true, retired: false })
    // A commit re-run after a crash does not move `committed_at`.
    const g = await fixture()
    effects.failures.set('drop_database', ['database_command_failed'])
    await run()
    const first = (await req(g)).committed_at as Date
    await pool.query("UPDATE tenant_deletion_steps SET state='running',finished_at=NULL WHERE request_id=$1 AND step='commit'", [g.request])
    await pool.query("UPDATE tenant_deletion_requests SET committed_at=committed_at - interval '1 hour' WHERE id=$1", [g.request])
    const earlier = (await req(g)).committed_at as Date
    await settle(); await run()
    expect((await req(g)).committed_at.getTime()).toBe(earlier.getTime())
    expect(earlier.getTime()).toBeLessThan(first.getTime())
    // After the deletion the registry keeps its tombstone (`retired: true`), which the freshness check reads to skip the tenant.
    expect((await req(g)).state).toBe('deleted')
    expect(await binding(g)).toMatchObject({ enabled: false, retired: true })
    expect(JSON.parse(readFileSync(registryPath, 'utf8')).targets.find((t: any) => t.tenantId === g.slug)).toMatchObject({ retired: true })
  })

  it('lets a customer remove a card after the plan was frozen without stalling the deletion: a removed card, a purged backup and a vanished copy re-freeze the plan, an unexplained change still defers', async () => {
    const f = await fixture({ card: true, backup: true })
    effects.atCommit(async () => {
      await removePaymentMethod(pool, adapter, { by: 'customer', actor: 'customer:1', reason: null, customer_id: f.customer, payment_method_id: f.card! })
      await pool.query("UPDATE shared_backups SET purged_at=now(),artifact_path=NULL,snapshot='{}'::jsonb WHERE id=$1", [f.backup]).catch(() => undefined)
    })
    await run()
    await settle(); await run()
    expect((await req(f)).state).toBe('deleted')
    expect(cardCalls).toEqual([`tok_${f.card}`]) // removed once, by the customer, never again by the runner
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE subject=$1 AND action='tenant_deletion.plan_refrozen'", [f.customer])).rows[0].n).toBeGreaterThanOrEqual(1)
  })

  it('does not call the relay or delete a card before the commit, and goes relay, database, cards, then the rest after it', async () => {
    const f = await fixture({ card: true })
    effects.holdAtCommit()
    await run()
    expect(effects.calls).not.toContain('unbind_relay'); expect(cardCalls).toEqual([])
    effects = new FakeEffects()
    await pool.query("UPDATE tenant_deletion_steps SET next_attempt_at=NULL WHERE request_id=$1", [f.request])
    await withdrawDeletion(pool, { ...who, customer_id: f.customer, by: 'vendor', reason: 'Back' })
    await run()
    expect(effects.calls).not.toContain('unbind_relay') // a withdrawal before the commit leaves TikTok connected: nothing was unbound
    const g = await fixture({ card: true })
    await run()
    const order = effects.calls.filter(c => ['unbind_relay', 'drop_database', 'delete_card', 'remove_filestore'].includes(c))
    expect(order).toEqual(['unbind_relay', 'drop_database', 'delete_card', 'remove_filestore'])
    expect((await steps(g)).drop_database.finished_at).not.toBeNull()
  })

  it('does not let a stuck request starve the others: waiting requests are not picked and stuck ones go last', async () => {
    for (let i = 0; i < 11; i++) {
      const stuck = await fixture()
      await pool.query("INSERT INTO tenant_deletion_steps(request_id,step,state,attempts,failures,started_at,next_attempt_at,error_code) VALUES($1,'preflight','failed',5,5,now() - interval '30 hours',now() + interval '5 hours','x_y')", [stuck.request])
      await pool.query("UPDATE tenant_deletion_requests SET stuck_at=now(),stuck_code='preflight:x_y',hold_until=now() - interval '2 days' WHERE id=$1", [stuck.request])
    }
    const fresh = await fixture()
    await run()
    expect((await req(fresh)).state).toBe('deleted')
  })
})
