import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { migrate } from '../db.js'
import { createApp } from '../http.js'
import { assertCatalogCompatible, CatalogGateError } from '../commercial/catalog-gate.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { createCustomerTerms } from '../commercial/customer-terms.js'
import { acceptQuote } from '../commercial/orders.js'
import { recordUsage } from '../commercial/usage.js'
import { url, client, money, monthly } from './commercial-helpers.js'
import { vendorSession } from './helpers/vendor-session.js'

const suite = url ? describe.sequential : describe.skip
const controlPlaneRoot = fileURLToPath(new URL('../..', import.meta.url))
const repositoryRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const REASON = 'Catalog compatibility gate test'
const POLICY_NO_TAX = '6f1c3d8e-0000-4000-8000-000000000002'
const SEEDED_PLAN_ID = '00000000-0000-4000-8000-0000000000b1'
const AI_LIMITS: Record<string, number | null> = {
  'ai.messages.monthly': null,
  'ai.tool_calls.per_run': null,
  'ai.tokens.monthly': null,
  'ai.assist.monthly': 100,
  'ai.output_tokens.per_run': null,
}

type SolutionJson = {
  schema_version: number
  descriptor_grammar: string
  id: string
  name: string
  description?: string
  industry: string
  base_modules: string[]
  tiers: Array<{
    id: string
    name: string
    description?: string
    sellable?: boolean
    modules: string[]
    features: string[]
  }>
}

function runCli(args: string[], env: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/admin.ts', ...args], {
      cwd: controlPlaneRoot,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        CONTROL_DATABASE_URL: url,
        CONTROL_INSTALLATION_ID: 'catalog-gate-cli-test',
        CONTROL_SERVICE_KEY: 'k'.repeat(40),
        ADMIN_SECRET_KEY: 's'.repeat(40),
        ADMIN_RP_ID: 'localhost',
        ADMIN_ORIGIN: 'http://localhost:3100',
        LIWAN_CLI_INVENTORY: '/tmp/liwan-cli-test/inventory.json',
        LIWAN_CLI_STATE_DIR: '/tmp/liwan-cli-test/state',
        LIWAN_REPOSITORY_ROOT: repositoryRoot,
        ...env,
      } as NodeJS.ProcessEnv,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

async function expectCatalogGateError(
  fn: () => Promise<unknown>,
  expectedCode: string,
  expectedAffectedCount: number,
): Promise<CatalogGateError> {
  try {
    await fn()
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogGateError)
    const gate = error as CatalogGateError
    expect(gate.code).toBe(expectedCode)
    expect(gate.status).toBe(409)
    expect(gate.affected_count).toBe(expectedAffectedCount)
    return gate
  }
  throw new Error(`Expected CatalogGateError(${expectedCode}, ${expectedAffectedCount}), but promise resolved`)
}

suite('commercial catalog compatibility gate & catalog-sync', () => {
  const pool = new Pool({ connectionString: url, max: 4 })
  const api = client(pool)
  const vendorActor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.pricing.manage', 'vendor.subscriptions.manage'] }
  const httpConfig = {
    installationId: 'catalog-gate-http-test',
    key: 'synthetic-catalog-gate-key-'.repeat(3),
    inventoryPath: '/unused',
    stateDir: '/unused',
    repositoryRoot,
    python: 'python3',
  }
  let server: ReturnType<typeof createApp> | undefined
  let origin: string
  let authHeaders: (method: string, path: string, body?: string) => Record<string, string>
  let baseSolution: SolutionJson
  let platformV5Bytes: Buffer
  let platformV5Sha256: string
  let seededPlans: Record<string, unknown>[] = []
  let seededPlanRevs: Record<string, unknown>[] = []

  const cloneBase = (): SolutionJson => JSON.parse(JSON.stringify(baseSolution))

  async function cleanTables() {
    await pool.query(`
      TRUNCATE
        usage_snapshots,
        subscriptions,
        subscription_revisions,
        orders,
        invoices,
        commercial_quotes,
        bundle_revisions,
        commercial_bundles,
        plan_revisions,
        commercial_plans,
        catalog_releases,
        catalog_entries,
        revision_references,
        customers,
        tenants,
        audit_events
      CASCADE
    `)
  }

  async function httpPost(path: string, body: Record<string, unknown>) {
    const raw = JSON.stringify(body)
    const response = await fetch(origin + path, {
      method: 'POST',
      body: raw,
      headers: { ...authHeaders('POST', path, raw), 'content-type': 'application/json' },
    })
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  async function seedRelease(solution: SolutionJson, version = `gate-${randomUUID()}`) {
    const raw = JSON.stringify(solution)
    await pool.query(
      "INSERT INTO catalog_entries(id,version,status,solution,source_sha256,published_at) VALUES($1,$2,'published',$3,$4,now())",
      [randomUUID(), version, solution, createHash('sha256').update(raw).digest('hex')],
    )
    const res = await api('POST', '/catalog/releases', { catalog_version: version, reason: REASON })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    return res.body as any
  }

  async function seedPublishedBundle(
    release: any,
    opts: { appId: string; featureKeys?: string[]; domainLimits?: Record<string, number | null>; priceMinor?: number; name?: string },
  ) {
    const app = release.applications.find((a: any) => a.id === opts.appId)
    expect(app, `app ${opts.appId} must exist in release`).toBeTruthy()
    const featureKeys = opts.featureKeys ?? app.features.filter((f: any) => f.kind === 'boolean' && f.selectable).map((f: any) => f.key)
    const draft = await api('POST', '/bundles', {
      name: opts.name ?? `Bundle ${opts.appId} ${randomUUID()}`,
      description: `Bundle for ${opts.appId}`,
      audience: { kind: 'public' },
      catalog_release_id: release.id,
      selections: [{ app_id: opts.appId, feature_keys: featureKeys }],
      domain_limits: opts.domainLimits ?? {},
      prices: [{ cadence: monthly, amount: money(opts.priceMinor ?? 5000) }],
    })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const valid = await api('POST', `/bundles/${draft.body.id}/validate`, { edit_revision: 1, reason: REASON })
    expect(valid.status, JSON.stringify(valid.body)).toBe(200)
    const pub = await api('POST', `/bundles/${draft.body.id}/publish`, { edit_revision: valid.body.edit_revision, reason: REASON })
    expect(pub.status, JSON.stringify(pub.body)).toBe(200)
    return pub.body as any
  }

  async function seedPublishedPlan(opts: {
    includedBundleIds?: string[]
    optionalBundleIds?: string[]
    platformLimits?: Record<string, number | null>
    name?: string
  } = {}) {
    const draft = await api('POST', '/plans', {
      name: opts.name ?? `Plan ${randomUUID()}`,
      audience: { kind: 'public' },
      term_months: 12,
      currency: 'SAR',
      prices: [{ cadence: monthly, amount: money(10000) }],
      platform_limits: opts.platformLimits ?? AI_LIMITS,
      included_bundle_revision_ids: opts.includedBundleIds ?? [],
      optional_bundle_revision_ids: opts.optionalBundleIds ?? [],
      included_extra_branches: 0,
      extra_branch_prices: [{ cadence: monthly, amount: money(0) }],
      extra_branches_limit: null,
      included_users: 1,
      included_storage_mb: 0,
      storage_step_mb: 10240,
      storage_step_threshold_mb: 102400,
      storage_large_step_mb: 102400,
      user_prices: [{ cadence: monthly, amount: money(0) }],
      storage_prices: [{ cadence: monthly, amount: money(0) }],
      policy_revision_id: POLICY_NO_TAX,
      trial_days: 0,
      grace_days: 0,
      auto_suspend: true,
      auto_renew_allowed: true,
    })
    expect(draft.status, JSON.stringify(draft.body)).toBe(201)
    const valid = await api('POST', `/plans/${draft.body.id}/validate`, { edit_revision: 1, reason: REASON })
    expect(valid.status, JSON.stringify(valid.body)).toBe(200)
    const pub = await api('POST', `/plans/${draft.body.id}/publish`, { edit_revision: valid.body.edit_revision, reason: REASON })
    expect(pub.status, JSON.stringify(pub.body)).toBe(200)
    return pub.body as any
  }

  async function seedActiveSubscription(
    planRevisionId: string,
    bundleRevisionIds: string[],
    opts: { termsLimits?: Record<string, number | null> } = {},
  ) {
    const customerId = randomUUID()
    const tenantId = randomUUID()
    await pool.query(
      "INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Gate tenant','saas','dedicated_managed',$2,true)",
      [tenantId, `gate-${tenantId}`],
    )
    await pool.query(
      'INSERT INTO customers(id,name,tenant_id,admin_name,admin_login) VALUES($1,$2,$3,$4,$5)',
      [customerId, 'Gate customer', tenantId, 'Manager', `gate-${customerId}@example.test`],
    )
    const terms = opts.termsLimits
      ? await createCustomerTerms(pool, { customer_id: customerId, reason: REASON, limits: opts.termsLimits }, vendorActor)
      : null
    const quote = await createQuoteForCustomer(pool, {
      customer_id: customerId,
      request: {
        kind: 'new',
        plan_revision_id: planRevisionId,
        bundle_revision_ids: bundleRevisionIds,
        ...(terms ? { terms_revision_id: terms.id } : {}),
        cadence: monthly,
        requested_extra_branches: 0,
        requested_users: 1,
        requested_storage_mb: 0,
      },
    })
    const { order } = await acceptQuote(
      pool,
      { quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: randomUUID() },
      vendorActor,
    )
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [order.id])
    await pool.query("UPDATE invoices SET status='paid',paid_at=now() WHERE order_id=$1", [order.id])
    await pool.query(
      "UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',renewal_at=$2,revision=revision+1 WHERE id=$1",
      [order.subscription_id, quote.next_renewal_at],
    )
    const row = (await pool.query('SELECT applied_revision_id FROM subscriptions WHERE id=$1', [order.subscription_id])).rows[0]
    return {
      subscriptionId: order.subscription_id as string,
      tenantId,
      customerId,
      appliedRevisionId: String(row.applied_revision_id),
      quote,
    }
  }

  beforeAll(async () => {
    await migrate(pool)
    platformV5Bytes = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform_v5.json'))
    platformV5Sha256 = createHash('sha256').update(platformV5Bytes).digest('hex')
    baseSolution = JSON.parse(platformV5Bytes.toString('utf8')) as SolutionJson

    // Preserve the migration-seeded LiwanOS plan so other suites running after us see the pristine post-migrate DB.
    seededPlans = (await pool.query('SELECT * FROM commercial_plans WHERE id=$1', [SEEDED_PLAN_ID])).rows
    seededPlanRevs = (await pool.query('SELECT * FROM plan_revisions WHERE plan_id=$1 ORDER BY version', [SEEDED_PLAN_ID])).rows

    authHeaders = (await vendorSession(pool, httpConfig.installationId, ['owner'], { key: httpConfig.key })).headers
    server = createApp(pool, httpConfig)
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP server failed to bind')
    origin = `http://127.0.0.1:${address.port}`
  })

  beforeEach(async () => {
    await cleanTables()
  })

  afterAll(async () => {
    await cleanTables()
    for (const plan of seededPlans) {
      await pool.query(
        'INSERT INTO commercial_plans(id,created_at,next_version) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
        [plan.id, plan.created_at, plan.next_version],
      )
    }
    for (const rev of seededPlanRevs) {
      const cols = Object.keys(rev)
      const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(',')
      const values = cols.map(c => {
        const v = rev[c]
        return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v
      })
      await pool.query(
        `INSERT INTO plan_revisions(${cols.join(',')}) VALUES(${placeholders}) ON CONFLICT (id) DO NOTHING`,
        values,
      )
    }
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    await pool.end()
  })

  it('refuses removing an application owned by an active subscription or published available bundle (catalog_app_in_use)', async () => {
    const release = await seedRelease(cloneBase())
    const projectsBundle = await seedPublishedBundle(release, { appId: 'projects' })
    const crmBundle = await seedPublishedBundle(release, { appId: 'crm' })
    const plan = await seedPublishedPlan({ optionalBundleIds: [projectsBundle.id, crmBundle.id] })
    await seedActiveSubscription(plan.id, [projectsBundle.id])

    // Dropping `projects` breaks both the published available bundle and the active subscription -> affected_count = 2.
    const dropProjects = cloneBase()
    dropProjects.tiers = dropProjects.tiers.filter(t => t.id !== 'projects')
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropProjects, 'drop-projects'),
      'catalog_app_in_use',
      2,
    )

    // Withdrawing `projectsBundle` leaves only the active subscription affected -> affected_count = 1.
    const withdrawn = await api('POST', `/bundles/${projectsBundle.id}/withdraw`, {
      edit_revision: projectsBundle.edit_revision,
      reason: REASON,
    })
    expect(withdrawn.status).toBe(200)
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropProjects, 'drop-projects-sub-only'),
      'catalog_app_in_use',
      1,
    )

    // Dropping `crm` affects only the published available `crmBundle` (no subscription owns CRM) -> affected_count = 1.
    const dropCrm = cloneBase()
    dropCrm.tiers = dropCrm.tiers.filter(t => t.id !== 'crm')
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropCrm, 'drop-crm-bundle-only'),
      'catalog_app_in_use',
      1,
    )

    // Dropping an unused app (`finance`) passes cleanly.
    const dropFinance = cloneBase()
    dropFinance.tiers = dropFinance.tiers.filter(t => t.id !== 'finance')
    await expect(assertCatalogCompatible(pool, dropFinance, 'drop-unused-finance')).resolves.toBeUndefined()
  })

  it('refuses removing a boolean feature selected by a published bundle or granted on an active subscription (catalog_feature_removed)', async () => {
    const release = await seedRelease(cloneBase())
    const projectsBundle = await seedPublishedBundle(release, {
      appId: 'projects',
      featureKeys: ['pmo.change_control', 'pmo.baselines', 'pmo.evm'],
    })
    const crmBundle = await seedPublishedBundle(release, {
      appId: 'crm',
      featureKeys: ['crm.import', 'crm.export'],
    })
    const plan = await seedPublishedPlan({ optionalBundleIds: [projectsBundle.id, crmBundle.id] })
    await seedActiveSubscription(plan.id, [projectsBundle.id])

    // Removing `boolean:pmo.evm` breaks both the published bundle and the active subscription -> affected_count = 2.
    const dropEvm = cloneBase()
    const projectsTier = dropEvm.tiers.find(t => t.id === 'projects')!
    projectsTier.features = projectsTier.features.filter(f => f !== 'boolean:pmo.evm')
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropEvm, 'drop-pmo-evm'),
      'catalog_feature_removed',
      2,
    )

    // Withdrawing the bundle leaves the active subscription alone -> affected_count = 1.
    const withdrawn = await api('POST', `/bundles/${projectsBundle.id}/withdraw`, {
      edit_revision: projectsBundle.edit_revision,
      reason: REASON,
    })
    expect(withdrawn.status).toBe(200)
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropEvm, 'drop-pmo-evm-sub-only'),
      'catalog_feature_removed',
      1,
    )

    // Removing a core boolean granted on the active subscription (`boolean:ai.knowledge`) -> affected_count = 1.
    const dropAiKnowledge = cloneBase()
    const coreTier = dropAiKnowledge.tiers.find(t => t.id === 'core')!
    coreTier.features = coreTier.features.filter(f => f !== 'boolean:ai.knowledge')
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropAiKnowledge, 'drop-ai-knowledge'),
      'catalog_feature_removed',
      1,
    )

    // Removing `boolean:crm.export` selected only by the published available `crmBundle` -> affected_count = 1.
    const dropCrmExport = cloneBase()
    const crmTier = dropCrmExport.tiers.find(t => t.id === 'crm')!
    crmTier.features = crmTier.features.filter(f => f !== 'boolean:crm.export')
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropCrmExport, 'drop-crm-export'),
      'catalog_feature_removed',
      1,
    )
  })

  it('refuses removing a non-derived limit key used by a published bundle, published plan, or active subscription (catalog_limit_removed)', async () => {
    const initial = cloneBase()
    const projectsInit = initial.tiers.find(t => t.id === 'projects')!
    projectsInit.features = projectsInit.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:10' : f)

    const release = await seedRelease(initial)
    const projectsBundle = await seedPublishedBundle(release, {
      appId: 'projects',
      domainLimits: { 'projects.max_projects': 5 },
    })
    const inboxBundle = await seedPublishedBundle(release, {
      appId: 'inbox',
      domainLimits: { 'inbox.channels': 3 },
    })
    const plan = await seedPublishedPlan({
      optionalBundleIds: [projectsBundle.id, inboxBundle.id],
      platformLimits: AI_LIMITS,
    })
    await seedActiveSubscription(plan.id, [projectsBundle.id])

    // 1) Removing `projects.max_projects` affects the published bundle (`domain_limits`) + active subscription -> affected_count = 2.
    const dropProjectsLimit = cloneBase()
    const projectsTier = dropProjectsLimit.tiers.find(t => t.id === 'projects')!
    projectsTier.features = projectsTier.features.filter(f => !f.startsWith('limit:projects.max_projects'))
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropProjectsLimit, 'drop-projects-limit'),
      'catalog_limit_removed',
      2,
    )

    // Withdrawing `projectsBundle` leaves only the active subscription affected -> affected_count = 1.
    const withdrawn = await api('POST', `/bundles/${projectsBundle.id}/withdraw`, {
      edit_revision: projectsBundle.edit_revision,
      reason: REASON,
    })
    expect(withdrawn.status).toBe(200)
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropProjectsLimit, 'drop-projects-limit-sub-only'),
      'catalog_limit_removed',
      1,
    )

    // 2) Removing `inbox.channels` affects only the published available `inboxBundle` (`domain_limits`) -> affected_count = 1.
    const dropInboxLimit = cloneBase()
    const inboxTier = dropInboxLimit.tiers.find(t => t.id === 'inbox')!
    inboxTier.features = inboxTier.features.filter(f => !f.startsWith('limit:inbox.channels'))
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropInboxLimit, 'drop-inbox-limit'),
      'catalog_limit_removed',
      1,
    )

    // 3) Removing `ai.assist.monthly` (a platform limit in `plan.platform_limits` and active subscription) -> affected_count = 2.
    const dropAiLimit = cloneBase()
    const coreTier = dropAiLimit.tiers.find(t => t.id === 'core')!
    coreTier.features = coreTier.features.filter(f => !f.startsWith('limit:ai.assist.monthly'))
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropAiLimit, 'drop-ai-assist-limit'),
      'catalog_limit_removed',
      2,
    )

    // With no active subscriptions (only the published plan carries `ai.assist.monthly` in `platform_limits`) -> affected_count = 1.
    await pool.query("UPDATE subscriptions SET state='cancelled', revision=revision+1")
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, dropAiLimit, 'drop-ai-assist-plan-only'),
      'catalog_limit_removed',
      1,
    )
  })

  it('refuses lowering a limit ceiling below fresh usage or when usage is missing/stale, and passes when all fresh snapshots fit (catalog_limit_below_usage)', async () => {
    const initial = cloneBase()
    const projectsInit = initial.tiers.find(t => t.id === 'projects')!
    projectsInit.features = projectsInit.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:10' : f)

    const release = await seedRelease(initial)
    const projectsBundle = await seedPublishedBundle(release, { appId: 'projects' })
    const plan = await seedPublishedPlan({ optionalBundleIds: [projectsBundle.id] })

    const subA = await seedActiveSubscription(plan.id, [projectsBundle.id])
    const subB = await seedActiveSubscription(plan.id, [projectsBundle.id])
    const subC = await seedActiveSubscription(plan.id, [projectsBundle.id])

    const lowered = cloneBase()
    const projectsLowered = lowered.tiers.find(t => t.id === 'projects')!
    projectsLowered.features = projectsLowered.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:5' : f)

    // All 3 tenants have MISSING usage_snapshots rows -> never treated as zero -> affected_count = 3.
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, lowered, 'lower-all-missing'),
      'catalog_limit_below_usage',
      3,
    )

    // Tenant A has fresh usage ABOVE ceiling (8 > 5); Tenant B has a STALE row with usage below ceiling (2 <= 5); Tenant C is still missing -> affected_count = 3.
    await recordUsage(pool, {
      tenant_id: subA.tenantId,
      observed_at: new Date(),
      metrics: { 'projects.max_projects': 8 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })
    await pool.query(
      `INSERT INTO usage_snapshots(tenant_id, observed_at, freshness, metrics, source)
       VALUES($1, now(), 'stale', $2::jsonb, 'gate-test')`,
      [subB.tenantId, JSON.stringify({ 'projects.max_projects': 2 })],
    )
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, lowered, 'lower-fresh-stale-missing'),
      'catalog_limit_below_usage',
      3,
    )

    // Give Tenant B and Tenant C fresh snapshots within the new ceiling (5 and 0); only Tenant A (fresh 8 > 5) fails -> affected_count = 1.
    await recordUsage(pool, {
      tenant_id: subB.tenantId,
      observed_at: new Date(Date.now() + 1000),
      metrics: { 'projects.max_projects': 5 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })
    await recordUsage(pool, {
      tenant_id: subC.tenantId,
      observed_at: new Date(),
      metrics: { 'projects.max_projects': 0 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, lowered, 'lower-one-over'),
      'catalog_limit_below_usage',
      1,
    )

    // Replacing Tenant A's latest snapshot with a STALE row (even with usage 1 <= 5) still refuses -> affected_count = 1.
    await pool.query(
      `INSERT INTO usage_snapshots(tenant_id, observed_at, freshness, metrics, source)
       VALUES($1, now() + interval '2 seconds', 'stale', $2::jsonb, 'gate-test')`,
      [subA.tenantId, JSON.stringify({ 'projects.max_projects': 1 })],
    )
    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, lowered, 'lower-one-stale'),
      'catalog_limit_below_usage',
      1,
    )

    // Once Tenant A also has a fresh snapshot within the new ceiling (4 <= 5), the gate passes.
    await recordUsage(pool, {
      tenant_id: subA.tenantId,
      observed_at: new Date(Date.now() + 5000),
      metrics: { 'projects.max_projects': 4 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })
    await expect(assertCatalogCompatible(pool, lowered, 'lower-all-fresh-ok')).resolves.toBeUndefined()
  })

  it('returns 409 plan_addon_in_use when dropping an active bundle without keep_for_existing, and succeeds with keep_for_existing: true', async () => {
    const release = await seedRelease(cloneBase())
    const projectsBundle = await seedPublishedBundle(release, { appId: 'projects' })
    const crmBundle = await seedPublishedBundle(release, { appId: 'crm' })
    const planV1 = await seedPublishedPlan({
      includedBundleIds: [projectsBundle.id],
      optionalBundleIds: [crmBundle.id],
    })

    const sub1 = await seedActiveSubscription(planV1.id, [projectsBundle.id])
    const sub2 = await seedActiveSubscription(planV1.id, [projectsBundle.id, crmBundle.id])

    // Clone v1 -> v2, edit v2 to drop projectsBundle from included_bundle_revision_ids, and validate.
    const revRes = await api('POST', `/plans/${planV1.id}/revisions`, {
      edit_revision: planV1.edit_revision,
      reason: REASON,
    })
    expect(revRes.status, JSON.stringify(revRes.body)).toBe(201)
    const v2 = revRes.body

    const edited = await api('PATCH', `/plans/${v2.id}`, {
      edit_revision: v2.edit_revision,
      reason: REASON,
      name: v2.name,
      audience: v2.audience,
      term_months: v2.term_months,
      currency: v2.currency,
      prices: v2.prices,
      platform_limits: v2.platform_limits,
      included_bundle_revision_ids: [],
      optional_bundle_revision_ids: [crmBundle.id],
      included_extra_branches: v2.included_extra_branches,
      extra_branch_prices: v2.extra_branch_prices,
      extra_branches_limit: v2.extra_branches_limit,
      included_users: v2.included_users,
      included_storage_mb: v2.included_storage_mb,
      storage_step_mb: v2.storage_step_mb,
      storage_step_threshold_mb: v2.storage_step_threshold_mb,
      storage_large_step_mb: v2.storage_large_step_mb,
      user_prices: v2.user_prices,
      storage_prices: v2.storage_prices,
      policy_revision_id: v2.policy_revision_id,
      trial_days: v2.trial_days,
      grace_days: v2.grace_days,
      auto_suspend: v2.auto_suspend,
      auto_renew_allowed: v2.auto_renew_allowed,
    })
    expect(edited.status, JSON.stringify(edited.body)).toBe(200)

    const validated = await api('POST', `/plans/${v2.id}/validate`, {
      edit_revision: edited.body.edit_revision,
      reason: REASON,
    })
    expect(validated.status, JSON.stringify(validated.body)).toBe(200)

    // Publishing via HTTP without keep_for_existing returns 409 plan_addon_in_use with affected_count = 2.
    const refused = await httpPost(`/v1/commercial/plans/${v2.id}/publish`, {
      edit_revision: validated.body.edit_revision,
      reason: REASON,
    })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({
      code: 'plan_addon_in_use',
      affected_count: 2,
    })

    // Confirm v1 is still available and v2 is still validated.
    expect((await pool.query('SELECT status, available FROM plan_revisions WHERE id=$1', [planV1.id])).rows[0]).toEqual({
      status: 'published',
      available: true,
    })
    expect((await pool.query('SELECT status, available FROM plan_revisions WHERE id=$1', [v2.id])).rows[0]).toEqual({
      status: 'validated',
      available: false,
    })

    // Publishing with keep_for_existing: true succeeds (200).
    const published = await httpPost(`/v1/commercial/plans/${v2.id}/publish`, {
      edit_revision: validated.body.edit_revision,
      reason: REASON,
      keep_for_existing: true,
    })
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    expect(published.body).toMatchObject({ id: v2.id, status: 'published', available: true })

    // Old plan revision is withdrawn for new buyers.
    expect((await pool.query('SELECT status, available FROM plan_revisions WHERE id=$1', [planV1.id])).rows[0]).toEqual({
      status: 'published',
      available: false,
    })

    // Existing subscriptions' applied revisions remain untouched.
    const subsAfter = (await pool.query(
      'SELECT id, applied_revision_id, target_revision_id FROM subscriptions WHERE id = ANY($1::uuid[])',
      [[sub1.subscriptionId, sub2.subscriptionId]],
    )).rows
    const byId = new Map(subsAfter.map((r: any) => [String(r.id), r]))
    expect(byId.get(sub1.subscriptionId)).toMatchObject({ applied_revision_id: sub1.appliedRevisionId, target_revision_id: null })
    expect(byId.get(sub2.subscriptionId)).toMatchObject({ applied_revision_id: sub2.appliedRevisionId, target_revision_id: null })

    // Audit metadata records keep_for_existing: true.
    const auditRow = (await pool.query(
      "SELECT metadata FROM audit_events WHERE action='plan.publish' AND subject=$1 ORDER BY created_at DESC LIMIT 1",
      [v2.id],
    )).rows[0]
    expect(auditRow?.metadata).toMatchObject({ keep_for_existing: true })
  })

  it('allows replacing a plan bundle with a newer revision of the same bundle_id, and points to optional_bundle_revision_ids when dropping only an optional add-on', async () => {
    const release = await seedRelease(cloneBase())
    const projectsV1 = await seedPublishedBundle(release, { appId: 'projects', priceMinor: 5000 })
    const crmBundle = await seedPublishedBundle(release, { appId: 'crm', priceMinor: 4000 })
    const planV1 = await seedPublishedPlan({
      includedBundleIds: [projectsV1.id],
      optionalBundleIds: [crmBundle.id],
    })
    await seedActiveSubscription(planV1.id, [projectsV1.id, crmBundle.id])

    // Create, edit, validate, and publish a newer revision of the SAME bundle_id for projects.
    const bundleRevRes = await api('POST', `/bundles/${projectsV1.id}/revisions`, {
      edit_revision: projectsV1.edit_revision,
      reason: REASON,
    })
    expect(bundleRevRes.status, JSON.stringify(bundleRevRes.body)).toBe(201)
    const projectsV2Draft = bundleRevRes.body
    expect(projectsV2Draft.bundle_id).toBe(projectsV1.bundle_id)
    expect(projectsV2Draft.id).not.toBe(projectsV1.id)

    const bundleEdited = await api('PATCH', `/bundles/${projectsV2Draft.id}`, {
      edit_revision: projectsV2Draft.edit_revision,
      reason: REASON,
      name: `${projectsV1.name} v2`,
      description: projectsV1.description,
      audience: projectsV1.audience,
      catalog_release_id: projectsV1.catalog_release_id,
      selections: projectsV1.selections,
      domain_limits: projectsV1.domain_limits,
      prices: [{ cadence: monthly, amount: money(6000) }],
    })
    expect(bundleEdited.status, JSON.stringify(bundleEdited.body)).toBe(200)
    const bundleValidated = await api('POST', `/bundles/${projectsV2Draft.id}/validate`, {
      edit_revision: bundleEdited.body.edit_revision,
      reason: REASON,
    })
    expect(bundleValidated.status, JSON.stringify(bundleValidated.body)).toBe(200)
    const bundlePublished = await api('POST', `/bundles/${projectsV2Draft.id}/publish`, {
      edit_revision: bundleValidated.body.edit_revision,
      reason: REASON,
    })
    expect(bundlePublished.status, JSON.stringify(bundlePublished.body)).toBe(200)
    const projectsV2 = bundlePublished.body

    // Clone plan v1 -> v2, swap projectsV1 for projectsV2 (same bundle_id), validate, and publish WITHOUT keep_for_existing.
    const planRevRes = await api('POST', `/plans/${planV1.id}/revisions`, {
      edit_revision: planV1.edit_revision,
      reason: REASON,
    })
    expect(planRevRes.status, JSON.stringify(planRevRes.body)).toBe(201)
    const planV2 = planRevRes.body
    const planEdited = await api('PATCH', `/plans/${planV2.id}`, {
      edit_revision: planV2.edit_revision,
      reason: REASON,
      name: planV2.name,
      audience: planV2.audience,
      term_months: planV2.term_months,
      currency: planV2.currency,
      prices: planV2.prices,
      platform_limits: planV2.platform_limits,
      included_bundle_revision_ids: [projectsV2.id],
      optional_bundle_revision_ids: [crmBundle.id],
      included_extra_branches: planV2.included_extra_branches,
      extra_branch_prices: planV2.extra_branch_prices,
      extra_branches_limit: planV2.extra_branches_limit,
      included_users: planV2.included_users,
      included_storage_mb: planV2.included_storage_mb,
      storage_step_mb: planV2.storage_step_mb,
      storage_step_threshold_mb: planV2.storage_step_threshold_mb,
      storage_large_step_mb: planV2.storage_large_step_mb,
      user_prices: planV2.user_prices,
      storage_prices: planV2.storage_prices,
      policy_revision_id: planV2.policy_revision_id,
      trial_days: planV2.trial_days,
      grace_days: planV2.grace_days,
      auto_suspend: planV2.auto_suspend,
      auto_renew_allowed: planV2.auto_renew_allowed,
    })
    expect(planEdited.status, JSON.stringify(planEdited.body)).toBe(200)
    const planValidated = await api('POST', `/plans/${planV2.id}/validate`, {
      edit_revision: planEdited.body.edit_revision,
      reason: REASON,
    })
    expect(planValidated.status, JSON.stringify(planValidated.body)).toBe(200)
    const planPublished = await httpPost(`/v1/commercial/plans/${planV2.id}/publish`, {
      edit_revision: planValidated.body.edit_revision,
      reason: REASON,
    })
    expect(planPublished.status, JSON.stringify(planPublished.body)).toBe(200)
    expect(planPublished.body).toMatchObject({ id: planV2.id, status: 'published', available: true })

    // Dropping only the optional add-on (crmBundle) refuses with field='optional_bundle_revision_ids'.
    const planV3Res = await api('POST', `/plans/${planV2.id}/revisions`, {
      edit_revision: planPublished.body.edit_revision,
      reason: REASON,
    })
    expect(planV3Res.status, JSON.stringify(planV3Res.body)).toBe(201)
    const planV3 = planV3Res.body
    const planV3Edited = await api('PATCH', `/plans/${planV3.id}`, {
      edit_revision: planV3.edit_revision,
      reason: REASON,
      name: planV3.name,
      audience: planV3.audience,
      term_months: planV3.term_months,
      currency: planV3.currency,
      prices: planV3.prices,
      platform_limits: planV3.platform_limits,
      included_bundle_revision_ids: [projectsV2.id],
      optional_bundle_revision_ids: [],
      included_extra_branches: planV3.included_extra_branches,
      extra_branch_prices: planV3.extra_branch_prices,
      extra_branches_limit: planV3.extra_branches_limit,
      included_users: planV3.included_users,
      included_storage_mb: planV3.included_storage_mb,
      storage_step_mb: planV3.storage_step_mb,
      storage_step_threshold_mb: planV3.storage_step_threshold_mb,
      storage_large_step_mb: planV3.storage_large_step_mb,
      user_prices: planV3.user_prices,
      storage_prices: planV3.storage_prices,
      policy_revision_id: planV3.policy_revision_id,
      trial_days: planV3.trial_days,
      grace_days: planV3.grace_days,
      auto_suspend: planV3.auto_suspend,
      auto_renew_allowed: planV3.auto_renew_allowed,
    })
    expect(planV3Edited.status, JSON.stringify(planV3Edited.body)).toBe(200)
    const planV3Validated = await api('POST', `/plans/${planV3.id}/validate`, {
      edit_revision: planV3Edited.body.edit_revision,
      reason: REASON,
    })
    expect(planV3Validated.status, JSON.stringify(planV3Validated.body)).toBe(200)
    const optionalRefused = await httpPost(`/v1/commercial/plans/${planV3.id}/publish`, {
      edit_revision: planV3Validated.body.edit_revision,
      reason: REASON,
    })
    expect(optionalRefused.status).toBe(409)
    expect(optionalRefused.body).toMatchObject({
      code: 'plan_addon_in_use',
      field: 'optional_bundle_revision_ids',
      affected_count: 1,
    })
  })

  it('allows publishing an unchanged catalog while active subscriptions hold terms.limits or domain_limits overrides above the catalog ceiling', async () => {
    // 1) Unchanged platform_v5.json (ai.assist.monthly:100) with a customer terms.limits override of 200 and no usage snapshots.
    await seedRelease(cloneBase())
    const basePlan = await seedPublishedPlan()
    await seedActiveSubscription(basePlan.id, [], { termsLimits: { 'ai.assist.monthly': 200 } })
    await expect(assertCatalogCompatible(pool, cloneBase(), 'unchanged-platform-v5')).resolves.toBeUndefined()

    // 2) Bundle domain_limits override (25) above the catalog ceiling (10) passes both when catalog ceiling is unchanged
    //    and when the catalog ceiling lowers to 5 (the bundle override still governs the subscription).
    const capped = cloneBase()
    const projectsCapped = capped.tiers.find(t => t.id === 'projects')!
    projectsCapped.features = projectsCapped.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:10' : f)
    const cappedRelease = await seedRelease(capped)
    const overriddenBundle = await seedPublishedBundle(cappedRelease, {
      appId: 'projects',
      domainLimits: { 'projects.max_projects': 25 },
    })
    const cappedPlan = await seedPublishedPlan({ optionalBundleIds: [overriddenBundle.id] })
    await seedActiveSubscription(cappedPlan.id, [overriddenBundle.id])

    await expect(assertCatalogCompatible(pool, capped, 'unchanged-capped-catalog')).resolves.toBeUndefined()

    const lowered = cloneBase()
    const projectsLowered = lowered.tiers.find(t => t.id === 'projects')!
    projectsLowered.features = projectsLowered.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:5' : f)
    await expect(assertCatalogCompatible(pool, lowered, 'lowered-but-bundle-overridden')).resolves.toBeUndefined()
  })

  it('rejects a usage_snapshots row marked fresh when observed_at is 6 hours old (catalog_limit_below_usage)', async () => {
    const initial = cloneBase()
    const projectsInit = initial.tiers.find(t => t.id === 'projects')!
    projectsInit.features = projectsInit.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:10' : f)

    const release = await seedRelease(initial)
    const projectsBundle = await seedPublishedBundle(release, { appId: 'projects' })
    const plan = await seedPublishedPlan({ optionalBundleIds: [projectsBundle.id] })
    const sub = await seedActiveSubscription(plan.id, [projectsBundle.id])

    const now = new Date('2026-11-26T12:00:00.000Z')
    const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    await recordUsage(pool, {
      tenant_id: sub.tenantId,
      observed_at: sixHoursAgo,
      metrics: { 'projects.max_projects': 1 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })

    const lowered = cloneBase()
    const projectsLowered = lowered.tiers.find(t => t.id === 'projects')!
    projectsLowered.features = projectsLowered.features.map(f => f === 'limit:projects.max_projects' ? 'limit:projects.max_projects:5' : f)

    await expectCatalogGateError(
      () => assertCatalogCompatible(pool, lowered, 'lower-aged-fresh', now),
      'catalog_limit_below_usage',
      1,
    )

    // Once a snapshot within the 15-minute freshness window is recorded, the gate passes.
    await recordUsage(pool, {
      tenant_id: sub.tenantId,
      observed_at: new Date(now.getTime() - 5 * 60 * 1000),
      metrics: { 'projects.max_projects': 1 },
      limit_gates: { 'projects.max_projects': ['pmo.enabled'] },
      source: 'gate-test',
    })
    await expect(assertCatalogCompatible(pool, lowered, 'lower-recent-fresh', now)).resolves.toBeUndefined()
  })

  it('runs catalog-sync end-to-end: syncs fresh, is idempotent on repeat, and logs catalog.sync_failed on errors', async () => {
    const version = `sync-${randomUUID()}`

    // 1) Fresh catalog-sync against platform_v5.json.
    const first = await runCli(['catalog-sync', version, 'Initial catalog sync'])
    expect(first.stderr).toBe('')
    expect(first.code).toBe(0)
    const firstJson = JSON.parse(first.stdout.trim()) as {
      status: string
      version: string
      release_id: string
      pushed: number
      failed: number
    }
    expect(firstJson).toMatchObject({
      status: 'synced',
      version,
      pushed: 0,
      failed: 0,
    })
    expect(firstJson.release_id).toMatch(/^[0-9a-f-]{36}$/)

    const entryRow = (await pool.query('SELECT status, published_at, source_sha256 FROM catalog_entries WHERE version=$1', [version])).rows
    expect(entryRow).toHaveLength(1)
    expect(entryRow[0].status).toBe('published')
    expect(entryRow[0].published_at).toBeTruthy()
    expect(entryRow[0].source_sha256).toBe(platformV5Sha256)

    const releaseRow = (await pool.query('SELECT id, catalog_version FROM catalog_releases WHERE catalog_version=$1', [version])).rows
    expect(releaseRow).toHaveLength(1)
    expect(releaseRow[0].id).toBe(firstJson.release_id)

    // 2) Repeat catalog-sync with same version & bytes -> idempotent, status='already_synced', no duplicates.
    const second = await runCli(['catalog-sync', version, 'Repeat catalog sync'])
    expect(second.stderr).toBe('')
    expect(second.code).toBe(0)
    const secondJson = JSON.parse(second.stdout.trim()) as typeof firstJson
    expect(secondJson).toMatchObject({
      status: 'already_synced',
      version,
      release_id: firstJson.release_id,
      pushed: 0,
      failed: 0,
    })
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_entries WHERE version=$1', [version])).rows[0].n).toBe(1)
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_releases WHERE catalog_version=$1', [version])).rows[0].n).toBe(1)

    // 3a) Same version with different source bytes -> exits non-zero, writes catalog.sync_failed, leaves row unpublished.
    const mismatchVersion = `sync-mismatch-${randomUUID()}`
    await pool.query(
      "INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'draft','{}'::jsonb,$3)",
      [randomUUID(), mismatchVersion, 'f'.repeat(64)],
    )
    const mismatch = await runCli(['catalog-sync', mismatchVersion, 'Different bytes sync'])
    expect(mismatch.code).not.toBe(0)
    const mismatchAudit = (await pool.query(
      "SELECT action, subject, reason, metadata FROM audit_events WHERE action='catalog.sync_failed' AND subject=$1",
      [mismatchVersion],
    )).rows
    expect(mismatchAudit).toHaveLength(1)
    expect(mismatchAudit[0].metadata).toMatchObject({ code: 'catalog_source_mismatch' })
    expect((await pool.query('SELECT status, published_at FROM catalog_entries WHERE version=$1', [mismatchVersion])).rows[0]).toEqual({
      status: 'draft',
      published_at: null,
    })
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_releases WHERE catalog_version=$1', [mismatchVersion])).rows[0].n).toBe(0)

    // 3b) Failing repo check -> exits non-zero, writes catalog.sync_failed, publishes nothing.
    const checkFailVersion = `sync-check-fail-${randomUUID()}`
    const checkFail = await runCli(['catalog-sync', checkFailVersion, 'Broken python sync'], {
      LIWAN_CLI_PYTHON: '/nonexistent/python3',
    })
    expect(checkFail.code).not.toBe(0)
    const checkFailAudit = (await pool.query(
      "SELECT action, subject, metadata FROM audit_events WHERE action='catalog.sync_failed' AND subject=$1",
      [checkFailVersion],
    )).rows
    expect(checkFailAudit).toHaveLength(1)
    expect(checkFailAudit[0].metadata).toMatchObject({ code: 'catalog_invalid' })
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_entries WHERE version=$1', [checkFailVersion])).rows[0].n).toBe(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_releases WHERE catalog_version=$1', [checkFailVersion])).rows[0].n).toBe(0)

    // 3c) Incompatible candidate (a published available bundle uses an app absent from platform_v5.json)
    // refuses both `catalog-sync` (writing catalog.sync_failed) and `POST /v1/catalog/:id/publish` (returning 409).
    const extendedSolution = cloneBase()
    extendedSolution.tiers.push({
      id: 'fieldwork',
      name: 'Fieldwork',
      description: 'Extra application absent from platform_v5.json',
      sellable: true,
      modules: ['liwan_fieldwork'],
      features: ['boolean:fieldwork.enabled'],
    })
    const extRelease = await seedRelease(extendedSolution, `ext-${randomUUID()}`)
    await seedPublishedBundle(extRelease, { appId: 'fieldwork', featureKeys: [] })

    const incompatVersion = `sync-incompat-${randomUUID()}`
    const incompat = await runCli(['catalog-sync', incompatVersion, 'Incompatible candidate sync'])
    expect(incompat.code).not.toBe(0)
    const incompatAudit = (await pool.query(
      "SELECT action, subject, metadata FROM audit_events WHERE action='catalog.sync_failed' AND subject=$1",
      [incompatVersion],
    )).rows
    expect(incompatAudit).toHaveLength(1)
    expect(incompatAudit[0].metadata).toMatchObject({ code: 'catalog_app_in_use', affected_count: 1 })
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_entries WHERE version=$1', [incompatVersion])).rows[0].n).toBe(0)
    expect((await pool.query('SELECT count(*)::int AS n FROM catalog_releases WHERE catalog_version=$1', [incompatVersion])).rows[0].n).toBe(0)

    // Verify HTTP POST /v1/catalog/:id/publish enforces the exact same gate with 409 + affected_count.
    const validatedId = randomUUID()
    await pool.query(
      "INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'validated',$3,$4)",
      [validatedId, `http-incompat-${validatedId}`, baseSolution, platformV5Sha256],
    )
    const httpRefused = await httpPost(`/v1/catalog/${validatedId}/publish`, { reason: REASON })
    expect(httpRefused.status).toBe(409)
    expect(httpRefused.body).toMatchObject({ code: 'catalog_app_in_use', affected_count: 1 })
    expect((await pool.query('SELECT status, published_at FROM catalog_entries WHERE id=$1', [validatedId])).rows[0]).toEqual({
      status: 'validated',
      published_at: null,
    })
  }, 120_000)
})
