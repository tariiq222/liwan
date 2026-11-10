// Real PostgreSQL: the vendor overview's failed-operations counter links to the `attention` list, so the two must agree
// for every state a shared job can reach (issue 446). Gated on CONTROL_TEST_DATABASE_URL; scratch databases only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { operationStatusesOf } from '@liwan/commercial-contracts'
import { migrate } from '../db.js'
import { publishRegistryMutation } from '../shared/registry-store.js'
import { enqueueSharedJob } from '../shared/job-store.js'
import { expireSharedLeases, recoverSharedJob, type SharedFencedAdapter } from '../shared/job-worker.js'
import { processJobAbandonments, requestSharedJobAbandon } from '../shared/job-abandon.js'
import { businessKey, payloadDigest } from '../shared/provisioning.js'
import { allOperationCounts, allOperations } from '../operation-feed.js'
import { vendorAccount } from './helpers/vendor-session.js'
import { vendorActorIssuer } from '../admin-auth/grants.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) {
  const parsed = new URL(url)
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) || !/^liwan_control_scratch_[a-z0-9_]+$/.test(parsed.pathname.slice(1))) throw new Error('CONTROL_TEST_DATABASE_URL must select a loopback liwan_control_scratch database')
}
describe.skipIf(!url)('operation counters and lists agree', () => {
  const pool = new Pool({ connectionString: url, max: 6 })
  const operator = { issuer: vendorActorIssuer('feed-counts-installation'), actorUid: 7 }
  const tenant = randomUUID()
  const absent: SharedFencedAdapter = { observe: async () => ({ state: 'absent' }), applyFenced: async () => { throw new Error('never executes') } }
  const present: SharedFencedAdapter = {
    observe: async job => ({ state: 'present', binding: job.binding, businessKey: businessKey(job), payloadDigest: payloadDigest(job), verified: true }),
    applyFenced: async () => { throw new Error('never executes') },
  }

  async function stuckJob() {
    const id = (await enqueueSharedJob(pool, tenant, operator, { schemaVersion: 1, operation: 'backup', requestId: randomUUID() }, 'Crashing backup')).id
    const payload = (await pool.query('SELECT payload FROM shared_jobs WHERE id=$1', [id])).rows[0].payload
    const attempt = randomUUID()
    await pool.query("UPDATE shared_jobs SET state='running',attempt_id=$1,fence=1,lease_until=clock_timestamp()+interval '120 seconds' WHERE id=$2 AND state='queued'", [attempt, id])
    await pool.query("INSERT INTO shared_job_events(job_id,attempt_id,fence,sequence,stage,evidence) VALUES($1,$2,1,1,'prepared','{\"state\":\"absent\"}'::jsonb)", [id, attempt])
    await pool.query('UPDATE shared_jobs SET journal=$1 WHERE id=$2 AND attempt_id=$3', [{ schemaVersion: 1, job: payload, attemptId: attempt, sequence: 1, stage: 'prepared' }, id, attempt])
    await pool.query("UPDATE shared_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1", [id])
    await expireSharedLeases(pool)
    return id
  }
  /** What the overview counter says and what its link lists, for the one job under test. */
  async function view() {
    const counts = await allOperationCounts(pool)
    const list = await allOperations(pool, '', 1, operationStatusesOf('attention'))
    return { counter: counts.failed_operations, listed: list.total }
  }

  beforeAll(async () => {
    const registryDir = await mkdtemp(join(tmpdir(), 'liwan-feed-counts-'))
    await mkdir(registryDir, { recursive: true })
    await migrate(pool)
    await pool.query('TRUNCATE shared_job_abandonments, shared_job_recoveries, shared_job_events, shared_jobs, shared_registry_audit, shared_registry_hosts, shared_registry_bindings, shared_registry_state CASCADE')
    await pool.query('TRUNCATE tenants, package_revisions, commercial_packages, catalog_entries CASCADE')
    await pool.query('TRUNCATE vendor_accounts CASCADE')
    await pool.query('TRUNCATE service_nonces, audit_events, operation_events, operations, restore_approvals')
    await pool.query('INSERT INTO shared_registry_state(singleton,revision) VALUES(true,0)')
    await vendorAccount(pool, ['customer_success', 'operations'], 7)
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,operations_enabled) VALUES ($1,'Counts tenant','saas','shared_managed','counts-gate','live-v1','core',true)", [tenant])
    await publishRegistryMutation(pool, join(registryDir, 'registry.json'), operator, { controlTenantId: tenant, expectedSnapshotRevision: 0, target: { host: 'counts.live-gate.invalid', tenantId: 'counts_a', database: 'counts_gate_a', filestore: 'counts_gate_a', enabled: true, registryRevision: 1 }, reason: 'Publish counts tenant' })
  })
  afterAll(async () => { await pool.end() })

  it('counts and lists nothing before any job is stuck', async () => {
    expect(await view()).toEqual({ counter: 0, listed: 0 })
  })
  it('counts and lists a stuck job', async () => {
    await stuckJob()
    expect(await view()).toEqual({ counter: 1, listed: 1 })
  })
  it('counts and lists the same for an abandoned job', async () => {
    const [id] = (await pool.query("SELECT id FROM shared_jobs WHERE state='needs_intervention'")).rows.map(r => r.id)
    await requestSharedJobAbandon(pool, tenant, id, operator, 'Operator inspected the worker host')
    await processJobAbandonments(pool, absent)
    expect((await pool.query('SELECT state FROM shared_jobs WHERE id=$1', [id])).rows[0].state).toBe('failed')
    // `failed` is an attention status, so the abandoned job stays in both until the model can mark it acknowledged.
    expect(await view()).toEqual({ counter: 1, listed: 1 })
  })
  it('counts and lists nothing for a recovered job', async () => {
    const id = await stuckJob()
    await pool.query("UPDATE shared_jobs SET state='verified',receipt='{\"schemaVersion\":1,\"status\":\"verified\"}'::jsonb WHERE state='failed'")
    expect(await view()).toEqual({ counter: 1, listed: 1 })
    expect((await recoverSharedJob(pool, id, operator, 'Operator verified externally', present)).state).toBe('verified')
    expect(await view()).toEqual({ counter: 0, listed: 0 })
  })
})
