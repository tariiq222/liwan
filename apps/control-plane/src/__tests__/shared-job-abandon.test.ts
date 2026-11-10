// Real PostgreSQL: an operator's request to abandon a shared job stuck in needs_intervention (issue 446). Gated on
// CONTROL_TEST_DATABASE_URL; never touches odoo19 or a non-scratch database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { migrate } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { expireSharedLeases, type SharedFencedAdapter } from '../shared/job-worker.js'
import { ABANDONABLE_OPERATIONS, processJobAbandonments, requestSharedJobAbandon, UnsupportedAbandonOperation } from '../shared/job-abandon.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'
import { vendorAccount } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback liwan_control_scratch database')
}
if (!url) describe.skip('shared job abandon (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared job abandon', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const issuer = vendorActorIssuer('abandon-installation')
  const operator = { issuer, actorUid: 7 }
  const outsider = { issuer, actorUid: 9 }
  const tenant = randomUUID()
  const reason = 'Operator inspected the worker host'
  const present: SharedFencedAdapter = {
    observe: async job => ({ state: 'present', binding: job.binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job), verified: true }),
    applyFenced: async () => { throw new Error('recovery must never re-execute') },
  }
  const absent: SharedFencedAdapter = { observe: async () => ({ state: 'absent' }), applyFenced: async () => { throw new Error('recovery must never re-execute') } }
  const verifiedReceipt = '{"schemaVersion":1,"status":"verified"}'

  /** A backup job whose worker died mid-run: lease expired, so the dispatcher quarantined it. */
  async function crashedJob() {
    const id = (await enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Crashing backup')).id
    const payload = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [id])).rows[0].payload
    const attempt = randomUUID()
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2 AND state='queued'", [attempt, id])
    await pool.query("INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,1,1,'prepared','{\"state\":\"absent\"}'::jsonb)", [id, attempt])
    await pool.query('UPDATE shared_jobs SET journal=$1 WHERE id=$2 AND attempt_id=$3', [{ schemaVersion: 1, job: payload, attemptId: attempt, sequence: 1, stage: 'prepared' }, id, attempt])
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id])
    await expireSharedLeases(pool)
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('needs_intervention')
    return id
  }
  const abandonment = async (id: string) => (await pool.query('SELECT state,error,completed_at FROM shared_job_abandonments WHERE job_id=$1', [id])).rows[0]
  const jobState = async (id: string) => (await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state
  /** Closes every job of the tenant so the next test starts unblocked. */
  const settle = () => pool.query("UPDATE shared_jobs SET state='verified',receipt=$2::jsonb WHERE control_tenant_id=$1 AND state IN ('queued','needs_intervention','running')", [tenant, verifiedReceipt])

  beforeAll(async () => {
    const registryDir = await mkdtemp(join(tmpdir(), 'liwan-abandon-'))
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    await pool.query('TRUNCATE shared_job_abandonments, shared_job_recoveries, shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    await pool.query('TRUNCATE service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
    await vendorAccount(pool, ['support'], 9)
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,'Abandon tenant','saas','shared_managed','abandon-gate','live-v1','core',true)", [tenant])
    await publishRegistryMutation(pool, join(registryDir, 'registry.json'), operator, { controlTenantId: tenant, expectedSnapshotRevision: 0, target: { host: 'abandon.live-gate.invalid', tenantId: 'abandon_a', database: 'abandon_gate_a', filestore: 'abandon_gate_a', enabled: true, registryRevision: 1 }, reason: 'Publish abandon tenant' })
  })
  afterAll(async () => { await pool.end() })

  it('closes a stuck job whose effect is absent, lifts the tenant block and audits both steps', async () => {
    const id = await crashedJob()
    await expect(enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Blocked'))
      .rejects.toThrow('shared_reconciliation_required')
    expect(await requestSharedJobAbandon(pool, tenant, id, operator, reason)).toEqual({ job_id: id, state: 'pending', replay: false })
    expect(await requestSharedJobAbandon(pool, tenant, id, operator, reason)).toEqual({ job_id: id, state: 'pending', replay: true })
    // The request alone changes nothing: the worker has not observed the effect yet.
    expect(await jobState(id)).toBe('needs_intervention')
    expect(await processJobAbandonments(pool, absent)).toBe(1)
    expect(await abandonment(id)).toMatchObject({ state: 'abandoned', error: null })
    expect(await jobState(id)).toBe('failed')
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='shared_job.abandon_requested' AND subject=$1", [id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT reason FROM audit_events WHERE action='shared_job.abandoned' AND subject=$1", [id])).rows[0].reason).toContain(reason)
    await expect(enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Accepted again')).resolves.toMatchObject({ state: 'queued' })
    // Nothing re-queues it and a second request for the closed job is refused.
    expect(await processJobAbandonments(pool, absent)).toBe(0)
    await expect(requestSharedJobAbandon(pool, tenant, id, operator, reason)).rejects.toThrow('shared_job_not_abandonable')
    await settle()
  })
  it('refuses to abandon when the effect exists: the job stays stuck for recovery', async () => {
    const id = await crashedJob()
    await requestSharedJobAbandon(pool, tenant, id, operator, reason)
    await processJobAbandonments(pool, present)
    expect(await abandonment(id)).toMatchObject({ state: 'effect_present', error: null })
    expect(await jobState(id)).toBe('needs_intervention')
    expect((await pool.query("SELECT action FROM audit_events WHERE subject=$1 AND action LIKE 'shared_job.abandon%' ORDER BY created_at", [id])).rows.map(r => r.action)).toEqual(['shared_job.abandon_requested', 'shared_job.abandon_refused'])
    await settle()
  })
  it.each(['partial', 'unknown'])('does not treat a %s observation as proof of absence', async state => {
    const id = await crashedJob()
    await requestSharedJobAbandon(pool, tenant, id, operator, reason)
    await processJobAbandonments(pool, { observe: async () => ({ state }), applyFenced: async () => { throw new Error('never executes') } })
    expect(await abandonment(id)).toMatchObject({ state: 'failed', error: `effect_not_proven_absent:${state}` })
    expect(await jobState(id)).toBe('needs_intervention')
    await settle()
  })
  it('never closes a job that moved after the effect was observed', async () => {
    const id = await crashedJob()
    await requestSharedJobAbandon(pool, tenant, id, operator, reason)
    const racing: SharedFencedAdapter = { applyFenced: async () => { throw new Error('never executes') },
      observe: async () => { await pool.query('UPDATE shared_jobs SET fence=fence+1 WHERE id=$1', [id]); return { state: 'absent' } } }
    await processJobAbandonments(pool, racing)
    expect(await abandonment(id)).toMatchObject({ state: 'failed', error: 'shared_lease_lost' })
    expect(await jobState(id)).toBe('needs_intervention')
    await settle()
  })
  /** Makes the next audit event of this action fail the way a lost connection does, then removes the fault. */
  async function withAuditFault<T>(action: string, run: () => Promise<T>) {
    await pool.query(`CREATE OR REPLACE FUNCTION abandon_test_fault() RETURNS trigger AS $$ BEGIN
      IF NEW.action = '${action}' THEN RAISE EXCEPTION 'simulated connection loss' USING ERRCODE = '08006'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER abandon_test_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION abandon_test_fault()')
    try { return await run() } finally { await pool.query('DROP TRIGGER abandon_test_fault ON audit_events') }
  }
  const auditActions = async (id: string) => (await pool.query("SELECT action FROM audit_events WHERE subject=$1 AND action LIKE 'shared_job.abandon%' ORDER BY created_at", [id])).rows.map(r => r.action)
  it('writes the outcome in the same transaction as the closure: a failure after closing leaves nothing half done', async () => {
    const id = await crashedJob()
    await requestSharedJobAbandon(pool, tenant, id, operator, reason)
    await withAuditFault('shared_job.abandoned', async () => {
      await expect(processJobAbandonments(pool, absent)).rejects.toThrow('simulated connection loss')
    })
    expect(await jobState(id)).toBe('needs_intervention')
    expect(await abandonment(id)).toMatchObject({ state: 'pending' })
    expect(await processJobAbandonments(pool, absent)).toBe(1)
    expect(await abandonment(id)).toMatchObject({ state: 'abandoned', error: null })
    expect(await jobState(id)).toBe('failed')
    expect(await auditActions(id)).toEqual(['shared_job.abandon_requested', 'shared_job.abandoned'])
    await settle()
  })
  it('recognises a request whose job its own closure already failed as done, never as refused', async () => {
    const id = await crashedJob()
    await requestSharedJobAbandon(pool, tenant, id, operator, reason)
    // The state a worker that stopped between closing the job and recording the outcome left behind.
    await pool.query("UPDATE shared_jobs SET state='failed',lease_until=NULL WHERE id=$1", [id])
    expect(await processJobAbandonments(pool, absent)).toBe(1)
    expect(await abandonment(id)).toMatchObject({ state: 'abandoned', error: null })
    expect(await auditActions(id)).toEqual(['shared_job.abandon_requested', 'shared_job.abandoned'])
    expect(await processJobAbandonments(pool, absent)).toBe(0)
    expect(await auditActions(id)).toHaveLength(2)
    await settle()
  })
  it('refuses a job that is not stuck, a foreign tenant, an unknown job and an operator without the grant', async () => {
    const queued = (await enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Queued backup')).id
    await expect(requestSharedJobAbandon(pool, tenant, queued, operator, reason)).rejects.toThrow('shared_job_not_abandonable')
    await expect(requestSharedJobAbandon(pool, tenant, randomUUID(), operator, reason)).rejects.toThrow('shared_job_not_abandonable')
    await expect(requestSharedJobAbandon(pool, randomUUID(), queued, operator, reason)).rejects.toThrow('tenant_operations_unavailable')
    await settle()
    const stuck = await crashedJob()
    await expect(requestSharedJobAbandon(pool, tenant, stuck, outsider, reason)).rejects.toThrow('shared_job_forbidden')
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_abandonments WHERE job_id=ANY($1::uuid[])', [[queued, stuck]])).rows[0].n).toBe(0)
    await settle()
  })
  it('is safe under concurrent identical requests: one record, one audit event', async () => {
    const id = await crashedJob()
    const results = await Promise.all([1, 2, 3].map(() => requestSharedJobAbandon(pool, tenant, id, operator, reason)))
    expect(results.filter(r => !r.replay)).toHaveLength(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_abandonments WHERE job_id=$1', [id])).rows[0].n).toBe(1)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='shared_job.abandon_requested' AND subject=$1", [id])).rows[0].n).toBe(1)
    await settle()
  })
  /** A job of any operation parked in needs_intervention (the payload is only read for its operation here). */
  async function stuckJob(operation: string | null) {
    const id = randomUUID()
    const payload = operation === null ? { schemaVersion: 1 } : { schemaVersion: 1, operation }
    await pool.query("INSERT INTO shared_jobs(id,control_tenant_id,business_key,payload,payload_digest,issuer,actor_uid,reason,state) VALUES($1,$2,$3,$4,$5,$6,7,'Fixture','needs_intervention')",
      [id, tenant, `fixture-${id}`, payload, 'a'.repeat(64), issuer])
    return id
  }
  it('allows exactly backup and restore', async () => {
    expect([...ABANDONABLE_OPERATIONS]).toEqual(['backup', 'restore'])
    for (const operation of ABANDONABLE_OPERATIONS) {
      const id = await stuckJob(operation)
      await expect(requestSharedJobAbandon(pool, tenant, id, operator, reason)).resolves.toMatchObject({ state: 'pending', replay: false })
      await pool.query("UPDATE shared_job_abandonments SET state='failed',error='fixture',completed_at=now() WHERE job_id=$1", [id])
    }
  })
  it.each(['provision', 'reconfigure', 'teleport', null])('refuses a stuck %s job before recording anything', async operation => {
    const id = await stuckJob(operation)
    const refusal = await requestSharedJobAbandon(pool, tenant, id, operator, reason).catch(error => error)
    expect(refusal).toBeInstanceOf(UnsupportedAbandonOperation)
    expect(refusal).toMatchObject({ message: 'shared_job_not_abandonable', detail: `Abandoning does not support the '${operation ?? 'unknown'}' operation` })
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_abandonments WHERE job_id=$1', [id])).rows[0].n).toBe(0)
  })
})
