// Operator-invoked acceptance against a fresh retained Foundation commercial stack.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { waitFor, run, writePrivate } from '../foundation_acceptance/lib.mjs'
import { createQuoteForCustomer } from '../../apps/control-plane/src/commercial/quotes.ts'
import { acceptQuote } from '../../apps/control-plane/src/commercial/orders.ts'
import { createPaymentAttempt, handleProviderEvent } from '../../apps/control-plane/src/commercial/payments.ts'
import { SimulatorAdapter } from '../../apps/control-plane/src/commercial/payment-simulator.ts'

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/u, '')
const scratch = join(root, '.scratch', 'saas-e12')
const runDir = realpathSync(process.argv[2] ?? scratch)
assert.equal(process.argv.length, 3, 'pass the retained Foundation run directory')
assert.equal(dirname(runDir), realpathSync(scratch), 'the fixture must belong to this worktree')
assert.match(basename(runDir), /^liwan-foundation-[a-zA-Z0-9]+$/u)
const readJson = name => JSON.parse(readFileSync(join(runDir, name), 'utf8'))
const fixture = readJson('run.json')
const result = readJson('result.json')
const runtime = readJson('runtime.json')
const [tenant] = result.tenants
const git = (...args) => {
  const result = run('git', args, { cwd: root })
  assert.equal(result.code, 0, `git ${args[0]} failed`)
  return result.stdout.trim()
}
const sourceCommit = git('rev-parse', 'HEAD')
assert.equal(fixture.sourceRoot, root)
assert.equal(result.sourceCommit, fixture.sourceCommit)
assert.match(fixture.sourceCommit, /^[a-f0-9]{40}$/u)
assert.equal(git('status', '--porcelain', '--', 'apps/control-plane', 'deploy', 'odoo-addons', 'tools/shared_saas_lifecycle'), '',
  'the worker and Odoo runtime sources must be committed')
assert.equal(git('diff', '--name-only', fixture.sourceCommit, sourceCommit, '--', 'deploy', 'odoo-addons', 'tools/shared_saas_lifecycle'), '',
  'reuse of Foundation images requires unchanged Odoo and deployment sources')
assert.equal(result.passed, true)
assert.equal(result.tenants.length, 1)
assert.ok(result.restored, 'a successful Foundation commercial run is required')
assert.match(fixture.project, /^liwan-shared-found-[a-f0-9]{16}$/u)
assert.equal(result.project, fixture.project)
assert.equal(runtime.projectName, fixture.project)
assert.equal(runtime.composeFile, join(runDir, 'compose.yml'))
assert.equal(runtime.envFile, join(runDir, 'compose.env'))
assert.equal(runtime.stateDir, join(runDir, 'state'))
assert.match(tenant.database, /^liwan_scratch_[a-f0-9]{32}$/u)
assert.equal(tenant.filestore, tenant.database)
assert.ok(Number.isInteger(fixture.ports.controlDbPort) && fixture.ports.controlDbPort > 1023 && fixture.ports.controlDbPort !== 5432)

const baseEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']
  .filter(key => process.env[key]).map(key => [key, process.env[key]]))
const evidenceDir = mkdtempSync(join(runDir, 'e12-'))
const events = []
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true })
const observe = (check, description, timeout) => waitFor(() => {
  assert.equal(interrupted, false, 'acceptance interrupted')
  return check()
}, description, timeout)
function record(name, data) {
  events.push({ name, time: new Date().toISOString(), ...data })
  console.log(name)
}
function compose(...args) {
  const result = run('docker', ['compose', '--project-name', fixture.project, '--env-file', runtime.envFile,
    '--file', runtime.composeFile, ...args], { cwd: root, env: baseEnv })
  assert.ok(result.ok, `Compose ${args[0]} exited with ${result.code ?? result.error}`)
  return result.stdout.trim()
}
const config = JSON.parse(compose('config', '--format', 'json'))
const database = 'liwan_control_scratch_foundation'
const dbConfig = config.services['control-db']
assert.equal(dbConfig.image, 'postgres:16')
assert.equal(dbConfig.environment.POSTGRES_DB, database)
assert.equal(dbConfig.environment.POSTGRES_USER, 'foundation')
assert.deepEqual(dbConfig.ports.map(port => [port.host_ip, Number(port.published), Number(port.target)]),
  [['127.0.0.1', fixture.ports.controlDbPort, 5432]])
assert.equal(compose('ps', '-q'), '', 'the Foundation run must have stopped its services')

const url = new URL(`postgresql://foundation@127.0.0.1:${fixture.ports.controlDbPort}/${database}`)
url.password = dbConfig.environment.POSTGRES_PASSWORD
const pool = new Pool({ connectionString: url.href, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
const workerUrl = new URL(url)
const workerApplication = 'liwan-e12-shared-worker'
workerUrl.searchParams.set('application_name', workerApplication)
const workerEnv = {
  ...baseEnv, NODE_ENV: 'development', LIWAN_TENANCY_MODE: 'shared',
  CONTROL_DATABASE_URL: workerUrl.href, CONTROL_INSTALLATION_ID: 'foundation-vendor',
  CONTROL_SERVICE_KEY: randomBytes(32).toString('hex'), LIWAN_REPOSITORY_ROOT: root,
  LIWAN_CLI_INVENTORY: join(runDir, 'inventory.json'), LIWAN_CLI_STATE_DIR: join(runDir, 'operator'),
  LIWAN_SHARED_RUNTIME_CONFIG: join(runDir, 'runtime.json'),
  LIWAN_TENANT_REGISTRY_PATH: join(runtime.stateDir, 'registry', 'registry.json'),
  LIWAN_PAYMENT_PROVIDER: 'simulator', LIWAN_PAYMENT_RETURN_ORIGINS: `https://*.${runtime.domainSuffix}`,
  LIWAN_PAYMENT_PROSPECT_ORIGIN: `https://app.${runtime.domainSuffix}`,
  LIWAN_COMMERCIAL_RECONCILE_EVERY: '1',
}
const one = async (sql, params) => {
  const { rows } = await pool.query(sql, params)
  assert.equal(rows.length, 1)
  return rows[0]
}
const odoo = sql => compose('exec', '-T', 'db', 'psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-U', 'odoo', '-d', tenant.database, '-c', sql)
const physical = () => JSON.parse(odoo(`SELECT row_to_json(r) FROM (
  SELECT commercial_revision_id AS revision, commercial_digest AS digest,
    (features->>'users.limit')::int AS users, quota_revision, policy_revision,
    commercial_valid_until_revision, commercial_applied_at, xmin::text AS row_version
  FROM liwan_tenant_profile) r`))
const control = orderId => one(`SELECT o.payment_state, o.fulfillment_state, o.target_revision_id,
  s.applied_revision_id, s.revision, e.operation_id, e.applied_at, e.receipt, j.id AS job_id,
  j.state AS job_state, j.receipt AS job_receipt, j.journal, j.attempt_id, j.fence::int, j.lease_until,
  i.status AS invoice_status, i.total_minor::int AS invoice_amount, i.currency,
  (SELECT count(*)::int FROM payment_attempts p WHERE p.order_id=o.id AND p.status='succeeded') AS charges,
  (SELECT count(*)::int FROM invoice_adjustments a WHERE a.invoice_id=i.id) AS adjustments,
  (SELECT count(*)::int FROM audit_events a WHERE a.subject=j.id::text AND a.action='shared_job.lease_expired') AS expired_attempts
  FROM orders o JOIN subscriptions s ON s.id=o.subscription_id JOIN invoices i ON i.order_id=o.id
  LEFT JOIN fulfillment_effects e ON e.order_id=o.id LEFT JOIN shared_jobs j ON j.id=e.job_id
  WHERE o.id=$1`, [orderId])

let worker
let launch = 0
function startWorker() {
  assert.equal(worker, undefined)
  const log = openSync(join(evidenceDir, `worker-${++launch}.log`), 'wx', 0o600)
  worker = spawn(join(root, 'deploy/control-plane/run-shared-worker.sh'), [], {
    cwd: root, env: workerEnv, detached: true, stdio: ['ignore', log, log],
  })
  closeSync(log)
  worker.on('error', error => { worker.startError = error })
}
function assertWorker() {
  if (worker?.startError) throw worker.startError
  assert.ok(worker?.pid && worker.exitCode === null && worker.signalCode === null, 'shared worker must be running')
}
async function killWorker() {
  if (!worker) return
  const child = worker
  worker = undefined
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  try { process.kill(-child.pid, 'SIGKILL') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  const [, signal] = await exited
  return signal === 'SIGKILL' ? child.pid : undefined
}
const adapter = new SimulatorAdapter({ env: { NODE_ENV: 'development' } })
const principal = {
  actor_id: 'e12-local-acceptance', kind: 'vendor', customer_id: null, tenant_id: null,
  capabilities: ['vendor.subscriptions.manage'],
}
async function createPaidChange(users) {
  const { customer_id, id, snapshot } = await one(`SELECT s.id,s.customer_id,r.snapshot FROM subscriptions s
    JOIN subscription_revisions r ON r.id=s.applied_revision_id WHERE s.tenant_id=$1 AND s.target_revision_id IS NULL`, [tenant.id])
  const quote = await createQuoteForCustomer(pool, { customer_id, request: {
    kind: 'change', subscription_id: id, plan_revision_id: snapshot.plan_revision_id,
    bundle_revision_ids: snapshot.bundle_revision_ids, cadence: snapshot.cadence,
    requested_extra_branches: snapshot.extra_branch_count, requested_users: users,
    requested_storage_mb: snapshot.entitlement.features['storage.limit_mb'],
  } })
  assert.ok(quote.due_now.minor > 0, 'the change must require a simulated charge')
  const { order } = await acceptQuote(pool, {
    quote_id: quote.id, expected_subscription_revision: quote.expected_subscription_revision, idempotency_key: randomUUID(),
  }, principal)
  const attempt = await createPaymentAttempt(pool, {
    order_id: order.id, customer_id, adapter, returnOrigin: async () => `https://${tenant.host}`,
  })
  adapter.settle(attempt.provider_ref, 'succeeded')
  const deliver = () => handleProviderEvent(pool, {
    provider: 'simulator', rawBody: adapter.webhookBody(attempt.provider_ref), headers: {}, adapter,
  })
  assert.equal((await deliver()).outcome, 'accepted')
  return { order, attempt, deliver }
}

// The scratch trigger only stops the selected order's transaction. The product
// worker, Odoo runner, payment settlement and all durable state transitions are real.
const lockKey = 186062341
let gateInstalled = false
async function installGate() {
  await pool.query(`CREATE FUNCTION e12_order_gate() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id::text = TG_ARGV[0] AND NEW.fulfillment_state = TG_ARGV[1] THEN
        PERFORM pg_advisory_xact_lock(${lockKey});
      END IF;
      RETURN NEW;
    END $$`)
  gateInstalled = true
}
function checkUnpublished(row, before) {
  assert.equal(row.payment_state, 'paid')
  assert.equal(row.invoice_status, 'paid')
  assert.equal(row.charges, 1)
  assert.equal(row.adjustments, 0)
  assert.equal(row.applied_revision_id, before.revision)
  assert.equal(row.applied_at, null)
  assert.equal(row.receipt, null)
  assert.equal(row.job_receipt, null)
  assert.equal(row.job_state, 'running')
}
async function waitForApplied(orderId) {
  let observed
  try {
    await observe(async () => {
      assertWorker()
      observed = await control(orderId)
      return observed.fulfillment_state === 'applied' && observed.job_state === 'verified'
    }, 'automatic recovery after the real 120-second lease', 165_000)
  } catch (error) {
    if (observed) record('recovery did not complete', { control: observed, physical: physical() })
    throw error
  }
  return observed
}

async function interruptAt(stage) {
  const before = physical()
  const { order, attempt, deliver } = await createPaidChange(before.users + 1)
  assert.match(order.id, /^[0-9a-f-]{36}$/u)
  const gate = await pool.connect()
  let cut
  let physicalAtCut
  try {
    await gate.query('BEGIN')
    await gate.query('SELECT pg_advisory_xact_lock($1)', [lockKey])
    await pool.query(`CREATE TRIGGER e12_order_gate BEFORE UPDATE OF fulfillment_state ON orders
      FOR EACH ROW EXECUTE FUNCTION e12_order_gate('${order.id}', '${stage}')`)
    startWorker()
    await observe(async () => {
      assertWorker()
      const { blocked } = await one(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE
        application_name=$1 AND wait_event='advisory' AND $2::int=ANY(pg_blocking_pids(pid))) AS blocked`,
      [workerApplication, gate.processID])
      return blocked
    }, `worker waiting in the ${stage} order transition`, 90_000)
    cut = await control(order.id)
    physicalAtCut = physical()
    checkUnpublished(cut, before)
    assert.ok(cut.operation_id && cut.attempt_id)
    assert.equal(cut.fulfillment_state, stage === 'applied' ? 'applying' : 'queued')
    if (stage === 'applied') {
      assert.equal(physicalAtCut.revision, order.target_revision_id)
      assert.equal(physicalAtCut.users, before.users + 1)
      assert.ok(physicalAtCut.digest)
    } else {
      assert.deepEqual(physicalAtCut, before)
    }
    const killedPid = await killWorker()
    assert.ok(killedPid, 'worker must receive SIGKILL at the observed cut')
    record(`SIGKILL at the ${stage} barrier`, { killedPid, before, physical: physicalAtCut, control: cut })
  } finally {
    await killWorker()
    await gate.query('ROLLBACK')
    gate.release()
    await pool.query('DROP TRIGGER IF EXISTS e12_order_gate ON orders')
  }

  startWorker()
  const recovered = await waitForApplied(order.id)
  assert.notEqual(recovered.attempt_id, cut.attempt_id)
  assert.ok(recovered.fence > cut.fence)
  assert.equal(recovered.expired_attempts, 1)
  assert.equal(recovered.job_id, cut.job_id)
  assert.equal(recovered.operation_id, cut.operation_id)
  assert.equal(recovered.applied_revision_id, order.target_revision_id)
  assert.equal(recovered.revision, cut.revision + 1)
  assert.ok(recovered.applied_at, 'successful control receipt must have a commit timestamp')
  assert.equal(recovered.receipt.order_id, order.id)
  assert.equal(recovered.receipt.database, tenant.database)
  assert.equal(recovered.receipt.target_revision_id, order.target_revision_id)
  assert.deepEqual(recovered.job_receipt, recovered.receipt)
  const after = physical()
  assert.equal(after.revision, order.target_revision_id)
  assert.equal(after.users, before.users + 1)
  assert.equal(after.digest, recovered.receipt.observed_entitlement_digest)
  assert.equal(after.policy_revision, before.policy_revision + 1)
  assert.equal(after.commercial_valid_until_revision, before.commercial_valid_until_revision + 1)
  if (stage === 'applied') assert.deepEqual(after, physicalAtCut, 'retry must not rewrite the already committed Odoo row')
  assert.equal((await deliver()).outcome, 'duplicate')
  assert.deepEqual(await control(order.id), recovered, 'simulator redelivery must not change the receipt or billing')
  assert.equal(recovered.charges, 1)
  assert.equal(recovered.adjustments, 0)
  assert.equal(recovered.invoice_status, 'paid')
  assert.equal(recovered.invoice_amount, attempt.amount.minor)
  record(`recovered from the ${stage} barrier with one physical effect and charge`, { physical: after, control: recovered })
  await killWorker()
}

async function checkCompensation() {
  const before = physical()
  const { order, attempt, deliver } = await createPaidChange(before.users + 1)
  assert.match(order.target_revision_id, /^[0-9a-f-]{36}$/u)
  // Force a rollback of this one Odoo write. The real effect runner classifies
  // the refusal, and only the product worker can transition the invoice.
  odoo(`CREATE FUNCTION e12_refuse_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.commercial_revision_id = '${order.target_revision_id}' THEN
        RAISE EXCEPTION 'E12 injected rollback';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER e12_refuse_revision BEFORE UPDATE OF commercial_revision_id ON liwan_tenant_profile
      FOR EACH ROW EXECUTE FUNCTION e12_refuse_revision()`)
  try {
    startWorker()
    await observe(async () => {
      const state = await control(order.id)
      return state.fulfillment_state === 'failed' && state.job_state === 'needs_intervention'
    }, 'paid Odoo rollback was classified as failed', 90_000)
    const failed = await control(order.id)
    assert.equal(failed.journal.error_code, 'subscription_script_failed')
    assert.equal(failed.payment_state, 'paid')
    assert.equal(failed.invoice_status, 'credit_pending')
    assert.equal(failed.applied_revision_id, before.revision)
    assert.equal(failed.receipt, null)
    assert.equal(failed.job_receipt, null)
    assert.equal(failed.charges, 1)
    assert.equal(failed.adjustments, 1)
    assert.equal(failed.applied_at, null)
    const credit = await one(`SELECT kind, status, origin, reason, amount_minor::int, currency, refund_reference, refunded_at
      FROM invoice_adjustments WHERE invoice_id=$1`, [attempt.invoice_id])
    assert.deepEqual(credit, {
      kind: 'credit_note', status: 'pending', origin: 'system', reason: 'subscription_script_failed',
      amount_minor: attempt.amount.minor, currency: attempt.amount.currency,
      refund_reference: null, refunded_at: null,
    })
    assert.deepEqual(physical(), before)
    await killWorker()
    startWorker()
    await observe(() => {
      assertWorker()
      return readFileSync(join(evidenceDir, `worker-${launch}.log`), 'utf8').includes('commercial_scheduler_tick')
    }, 'shared worker completed a reconciliation tick after compensation')
    assert.equal((await deliver()).outcome, 'duplicate')
    assert.deepEqual(await control(order.id), failed)
    assert.deepEqual(physical(), before)
    record('paid rollback left exactly one full pending credit note after restart and redelivery', { credit, control: failed, physical: before })
  } finally {
    await killWorker()
    odoo(`DROP TRIGGER e12_refuse_revision ON liwan_tenant_profile; DROP FUNCTION e12_refuse_revision()`)
  }
}

let passed = false
let started = false
let stopped = false
try {
  started = true
  compose('up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', 'db', 'odoo', 'control-db')
  assert.equal((await one('SELECT current_database() AS name')).name, database)
  assert.ok(physical().revision)
  record('scratch PostgreSQL and Odoo are healthy')
  await installGate()
  await interruptAt('applied')
  await interruptAt('applying')
  await checkCompensation()
  passed = true
} finally {
  try {
    await killWorker()
    if (gateInstalled) {
      await pool.query('DROP TRIGGER IF EXISTS e12_order_gate ON orders')
      await pool.query('DROP FUNCTION e12_order_gate()')
    }
  } finally {
    await pool.end()
    try {
      if (started) compose('stop', '--timeout', '20', 'odoo', 'db', 'control-db')
      stopped = true
    } finally {
      writePrivate(join(evidenceDir, 'result.json'), JSON.stringify({
        passed: passed && stopped, sourceCommit, fixtureCommit: fixture.sourceCommit, project: fixture.project,
        imageIdentities: result.imageIdentities, events,
      }, null, 2))
      console.log(`E12 evidence: ${evidenceDir}`)
    }
  }
}
