import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { catalogApplicationsFromSolution } from '../commercial/catalog.js'
import { compileEntitlements } from '../commercial/entitlements.js'
import type { BundleRevision, CatalogRelease, PlanRevision } from '../commercial/types.js'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../../deploy/catalog/solutions/${name}`, import.meta.url), 'utf8'))
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
/** The AI limits a plan must carry (owner decision 2026-11-06, W8); the compiler refuses a plan that omits one.
 * `ai.setup.monthly` is not among them: the AI addon replaced it with `ai.assist.monthly` (migration 19.0.1.8.0). */
const AI_LIMITS = { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100,
  'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 }

/** Release 1 composition (owner decision 2026-11-06): the always-included set and the two sold applications. */
const INCLUDED = ['tasks.enabled', 'chat.enabled', 'documents.enabled', 'meetings.enabled', 'operations.enabled', 'ai.enabled']
const SOLD = ['crm.enabled', 'inbox.enabled']
const LOCKED = ['hr.enabled', 'finance.enabled', 'pmo.enabled', 'appointments.enabled', 'integrations.enabled']

function releaseOf(name = 'platform_v4.json'): CatalogRelease {
  return { id: id(1), version: name, source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64), applications: catalogApplicationsFromSolution(read(name), name) }
}

function plan(release: CatalogRelease, bundles: BundleRevision[]): PlanRevision {
  return { id: id(4), plan_id: id(5), version: 1, edit_revision: 1, name: 'LiwanOS', status: 'published', available: true,
    audience: { kind: 'public' }, term_months: 12, prices: [], platform_limits: AI_LIMITS, included_bundle_revision_ids: [],
    optional_bundle_revision_ids: bundles.map(b => b.id), included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null,
    included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400, user_prices: [], storage_prices: [], policy_revision_id: id(6),
    currency: 'SAR', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true }
}

function bundle(release: CatalogRelease, n: number, app: string): BundleRevision {
  return { id: id(n), bundle_id: id(n + 20), version: 1, edit_revision: 1, name: app, description: app, audience: { kind: 'public' },
    status: 'published', available: true, catalog_release_id: release.id, selections: [{ app_id: app, feature_keys: [] }],
    domain_limits: {}, prices: [] }
}

function features(purchased: BundleRevision[]) {
  const release = releaseOf()
  return compileEntitlements({ release, plan: plan(release, purchased), bundles: purchased, terms: null, quantities: { users: 3, storage_mb: 5120 } }).features
}

describe('release 1 catalog composition (platform_v4)', () => {
  it('sells only CRM and customer messages', () => {
    const sold = releaseOf().applications.filter(app => app.sellable).map(app => app.id)
    expect(sold).toEqual(['crm', 'inbox'])
  })

  it('keeps tasks and chat in the core tier and drops their own tiers', () => {
    const apps = releaseOf().applications
    expect(apps.find(app => app.id === 'core')?.modules).toContain('liwan_tasks')
    expect(apps.find(app => app.id === 'core')?.modules).toContain('liwan_chat')
    expect(apps.map(app => app.id)).not.toContain('tasks')
    expect(apps.map(app => app.id)).not.toContain('messaging')
  })

  it('installs the whole release in every tenant while locking the unsold applications', () => {
    const release = releaseOf()
    const all = release.applications.flatMap(app => app.modules).sort()
    expect(compileEntitlements({ release, plan: plan(release, []), bundles: [], terms: null, quantities: { users: 3, storage_mb: 5120 } }).modules).toEqual(all)
  })
})

describe('release 1 entitlement boundaries', () => {
  it('opens the included set and closes everything unsold for a customer that buys nothing', () => {
    const open = features([])
    for (const key of INCLUDED) expect(open[key], key).toBe(true)
    for (const key of [...SOLD, ...LOCKED]) expect(open[key], key).toBe(false)
  })

  it('opens CRM alone when only CRM is bought', () => {
    const release = releaseOf()
    const open = features([bundle(release, 2, 'crm')])
    expect(open['crm.enabled']).toBe(true)
    for (const key of ['inbox.enabled', ...LOCKED]) expect(open[key], key).toBe(false)
    for (const key of INCLUDED) expect(open[key], key).toBe(true)
  })

  it('keeps the payment gateway open in core, so a messages-only customer can check out', () => {
    // Owner decision (A6): connecting the tenant's own gateway is free. `inbox_payments` routes need
    // `payments.enabled`, so locking it would close the WhatsApp catalog checkout for the one app that sells.
    const messagesOnly = features([bundle(releaseOf(), 3, 'inbox')])
    expect(messagesOnly['payments.enabled']).toBe(true)
    expect(messagesOnly['inbox.enabled']).toBe(true)
    // It is free, not for sale: no tier sells it.
    expect(releaseOf().applications.filter(app => app.sellable).map(app => app.id)).not.toContain('payments')
  })

  it('still keeps an empty or HR-only purchase away from the sold applications', () => {
    expect(features([])['crm.enabled']).toBe(false)
    expect(features([])['inbox.enabled']).toBe(false)
  })

  it('opens customer messages alone when only messages are bought', () => {
    const release = releaseOf()
    const open = features([bundle(release, 3, 'inbox')])
    expect(open['inbox.enabled']).toBe(true)
    expect(open['inbox.whatsapp']).toBe(true)
    expect(open['inbox.tiktok']).toBe(true)
    for (const key of ['crm.enabled', ...LOCKED]) expect(open[key], key).toBe(false)
  })

  it('refuses to grant an application that is installed but not sold', () => {
    const release = releaseOf()
    for (const app of ['people', 'finance', 'projects', 'appointments', 'integrations']) {
      expect(() => compileEntitlements({ release, plan: plan(release, [bundle(release, 9, app)]), bundles: [bundle(release, 9, app)], terms: null, quantities: { users: 3, storage_mb: 5120 } }), app)
        .toThrow(expect.objectContaining({ code: 'app_not_selectable' }))
    }
  })
})

describe('the release keeps the previous catalogs untouched', () => {
  it('leaves platform_v3 exactly as it was', () => {
    const v3 = read('platform_v3.json') as { tiers: Array<{ id: string; sellable?: boolean }> }
    expect(v3.tiers.map(tier => tier.id)).toEqual(['core', 'projects', 'people', 'messaging', 'tasks'])
    expect(v3.tiers.some(tier => tier.sellable !== undefined)).toBe(false)
  })

  it('declares no AI limit the AI addon does not register', () => {
    const registered = read('platform_v4.json').tiers.find((tier: { id: string }) => tier.id === 'core').features as string[]
    const ai = registered.filter(entry => entry.split(':')[1]!.startsWith('ai.') && entry.startsWith('limit:'))
    expect(ai.map(entry => entry.split(':')[1])) .toEqual(['ai.messages.monthly', 'ai.tool_calls.per_run', 'ai.tokens.monthly', 'ai.assist.monthly', 'ai.output_tokens.per_run'])
    expect(registered).not.toContain('limit:ai.setup.monthly')
  })
})
