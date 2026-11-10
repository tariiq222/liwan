// Real PostgreSQL: an operator's recovery request for a shared job stuck in needs_intervention. Gated on
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
import { expireSharedLeases, recoverSharedJob, type SharedFencedAdapter } from '../shared/job-worker.js'
import { processJobRecoveries, RECOVERABLE_OPERATIONS, requestSharedJobRecovery, UnsupportedRecoveryOperation } from '../shared/job-recovery.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'
import { vendorAccount } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a unique loopback liwan_control_scratch database')
}
if (!url) describe.skip('shared job recovery (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('shared job recovery', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const issuer = vendorActorIssuer('recovery-installation')
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
  const recovery = async (id: string) => (await pool.query('SELECT state,error,completed_at FROM shared_job_recoveries WHERE job_id=$1', [id])).rows[0]
  /** Closes every job of the tenant so the next test starts unblocked. */
  const settle = () => pool.query("UPDATE shared_jobs SET state='verified',receipt=$2::jsonb WHERE control_tenant_id=$1 AND state IN ('queued','needs_intervention','running')", [tenant, verifiedReceipt])

  beforeAll(async () => {
    const registryDir = await mkdtemp(join(tmpdir(), 'liwan-recovery-'))
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    await pool.query('TRUNCATE shared_job_recoveries, shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    await pool.query('TRUNCATE service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
    await vendorAccount(pool, ['support'], 9)
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,'Recovery tenant','saas','shared_managed','recovery-gate','live-v1','core',true)", [tenant])
    await publishRegistryMutation(pool, join(registryDir, 'registry.json'), operator, { controlTenantId: tenant, expectedSnapshotRevision: 0, target: { host: 'recovery.live-gate.invalid', tenantId: 'recovery_a', database: 'recovery_gate_a', filestore: 'recovery_gate_a', enabled: true, registryRevision: 1 }, reason: 'Publish recovery tenant' })
  })
  afterAll(async () => { await pool.end() })

  it('blocks every other command until the stuck job is recovered, then accepts a new one', async () => {
    const id = await crashedJob()
    await expect(enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Blocked'))
      .rejects.toThrow('shared_reconciliation_required')
    expect(await requestSharedJobRecovery(pool, tenant, id, operator, reason)).toEqual({ job_id: id, state: 'pending', replay: false })
    expect(await requestSharedJobRecovery(pool, tenant, id, operator, reason)).toEqual({ job_id: id, state: 'pending', replay: true })
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='shared_job.recovery_requested' AND subject=$1", [id])).rows[0].n).toBe(1)
    // The request alone changes nothing: the worker has not observed the effect yet.
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('needs_intervention')
    expect(await processJobRecoveries(pool, present)).toBe(1)
    expect(await recovery(id)).toMatchObject({ state: 'verified', error: null })
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('verified')
    expect((await pool.query("SELECT reason FROM audit_events WHERE action='shared_job.recovery_completed' AND subject=$1", [id])).rows[0].reason).toBe('verified')
    await expect(enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Accepted again')).resolves.toMatchObject({ state: 'queued' })
    expect(await processJobRecoveries(pool, present)).toBe(0)
    await settle()
  })
  it('refuses a job that is not in needs_intervention, a foreign tenant and an unknown job with shared_job_not_recoverable', async () => {
    const queued = (await enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Queued backup')).id
    await expect(requestSharedJobRecovery(pool, tenant, queued, operator, reason)).rejects.toThrow('shared_job_not_recoverable')
    await expect(requestSharedJobRecovery(pool, tenant, randomUUID(), operator, reason)).rejects.toThrow('shared_job_not_recoverable')
    // The job exists but belongs to the tenant of the path only.
    await expect(requestSharedJobRecovery(pool, randomUUID(), queued, operator, reason)).rejects.toThrow('tenant_operations_unavailable')
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_recoveries WHERE job_id=$1', [queued])).rows[0].n).toBe(0)
    await settle()
  })
  it('refuses an operator who does not hold the operations grant', async () => {
    const id = await crashedJob()
    await expect(requestSharedJobRecovery(pool, tenant, id, outsider, reason)).rejects.toThrow('shared_job_forbidden')
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_recoveries WHERE job_id=$1', [id])).rows[0].n).toBe(0)
    await settle()
  })
  it('keeps the job stuck when the effect cannot be confirmed, and lets the operator ask again', async () => {
    const id = await crashedJob()
    await requestSharedJobRecovery(pool, tenant, id, operator, reason)
    await processJobRecoveries(pool, absent)
    expect(await recovery(id)).toMatchObject({ state: 'still_needs_intervention', error: null })
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('needs_intervention')
    expect(await requestSharedJobRecovery(pool, tenant, id, operator, 'Operator checked again')).toMatchObject({ state: 'pending', replay: false })
    await processJobRecoveries(pool, present)
    expect(await recovery(id)).toMatchObject({ state: 'verified' })
    await settle()
  })
  it('records a recovery that cannot run as failed with its error instead of stopping the worker', async () => {
    const id = await crashedJob()
    await requestSharedJobRecovery(pool, tenant, id, operator, reason)
    // The job is resolved by someone else before the worker picks the request up.
    await pool.query("UPDATE shared_jobs SET state='verified',receipt=$2::jsonb WHERE id=$1", [id, verifiedReceipt])
    expect(await processJobRecoveries(pool, present)).toBe(1)
    expect(await recovery(id)).toMatchObject({ state: 'failed', error: 'shared_job_not_recoverable' })
    expect((await pool.query("SELECT reason FROM audit_events WHERE action='shared_job.recovery_completed' AND subject=$1", [id])).rows[0].reason).toBe('failed: shared_job_not_recoverable')
  })
  const completions = async (id: string) => (await pool.query("SELECT reason FROM audit_events WHERE subject=$1 AND action='shared_job.recovery_completed' ORDER BY created_at", [id])).rows.map(r => r.reason)
  it('writes the outcome in the same transaction as the verification: a failure after it leaves nothing half done', async () => {
    const id = await crashedJob()
    await requestSharedJobRecovery(pool, tenant, id, operator, reason)
    await pool.query(`CREATE OR REPLACE FUNCTION recovery_test_fault() RETURNS trigger AS $$ BEGIN
      IF NEW.action = 'shared_job.recovery_completed' THEN RAISE EXCEPTION 'simulated connection loss' USING ERRCODE = '08006'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query('CREATE TRIGGER recovery_test_fault BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION recovery_test_fault()')
    try { await expect(processJobRecoveries(pool, present)).rejects.toThrow('simulated connection loss') } finally { await pool.query('DROP TRIGGER recovery_test_fault ON audit_events') }
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('needs_intervention')
    expect(await recovery(id)).toMatchObject({ state: 'pending' })
    expect(await processJobRecoveries(pool, present)).toBe(1)
    expect(await recovery(id)).toMatchObject({ state: 'verified', error: null })
    expect(await completions(id)).toEqual(['verified'])
    await settle()
  })
  it('recognises a request whose job its own recovery already verified as done, never as failed', async () => {
    const id = await crashedJob()
    await requestSharedJobRecovery(pool, tenant, id, operator, reason)
    // The state a worker that stopped between verifying the job and recording the outcome left behind.
    expect((await recoverSharedJob(pool, id, operator, reason, present)).state).toBe('verified')
    expect(await recovery(id)).toMatchObject({ state: 'pending' })
    expect(await processJobRecoveries(pool, absent)).toBe(1)
    expect(await recovery(id)).toMatchObject({ state: 'verified', error: null })
    expect(await completions(id)).toEqual(['verified'])
    expect(await processJobRecoveries(pool, absent)).toBe(0)
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
  it('accepts exactly the operations the worker can reconcile, and nothing else', async () => {
    expect([...RECOVERABLE_OPERATIONS]).toEqual(['provision', 'backup', 'restore'])
    for (const operation of RECOVERABLE_OPERATIONS) {
      const id = await stuckJob(operation)
      await expect(requestSharedJobRecovery(pool, tenant, id, operator, reason)).resolves.toMatchObject({ state: 'pending', replay: false })
      await pool.query("UPDATE shared_job_recoveries SET state='failed',error='fixture',completed_at=now() WHERE job_id=$1", [id])
    }
  })
  it.each(['reconfigure', 'teleport', null])('refuses a stuck %s job at the endpoint before recording anything', async operation => {
    const id = await stuckJob(operation)
    const refusal = await requestSharedJobRecovery(pool, tenant, id, operator, reason).catch(error => error)
    expect(refusal).toBeInstanceOf(UnsupportedRecoveryOperation)
    expect(refusal).toMatchObject({ message: 'shared_job_not_recoverable', detail: `Recovery does not support the '${operation ?? 'unknown'}' operation` })
    expect((await pool.query('SELECT count(*)::int AS n FROM shared_job_recoveries WHERE job_id=$1', [id])).rows[0].n).toBe(0)
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action='shared_job.recovery_requested' AND subject=$1", [id])).rows[0].n).toBe(0)
  })
  it('does not hand an unsupported operation to the adapter if a request for one is ever found pending', async () => {
    const id = await stuckJob('reconfigure')
    await pool.query("INSERT INTO shared_job_recoveries(job_id,issuer,actor_uid,reason) VALUES($1,$2,7,$3)", [id, issuer, reason])
    const observe: SharedFencedAdapter = { observe: async () => { throw new Error('must not observe') }, applyFenced: async () => { throw new Error('must not apply') } }
    expect(await processJobRecoveries(pool, observe)).toBe(1)
    expect(await recovery(id)).toMatchObject({ state: 'failed', error: 'operation_unsupported:reconfigure' })
  })
})
