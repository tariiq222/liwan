import { Pool } from 'pg'
import { randomUUID, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { migrate } from '../db.js'
import { commercialHttp } from '../commercial/http.js'
import { CommercialHttpError } from '../commercial/lifecycle.js'

export const url = process.env.CONTROL_TEST_DATABASE_URL
if (url) { const p = new URL(url); if (!['127.0.0.1', 'localhost', '::1'].includes(p.hostname) || !/^liwan_control_scratch_[a-z0-9]+$/.test(p.pathname.slice(1))) throw Error('scratch control DB required') }
export const ALL = ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'] as any[]
/**
 * The engine's own fixture catalog: every application sellable, so a test can exercise a bundle on any of them.
 *
 * It is deliberately NOT a release file. Release composition (what release 1 actually sells) changes with an owner
 * decision, and an engine test that depended on it would fail every time the release changed for reasons that have
 * nothing to do with the engine. The release's own behaviour is covered by the `commercial-release1-*` suites.
 */
function engineSolution() {
  const tiers = [
    // The base modules carry the platform; a core tier with no modules of its own is what the enrollment path expects.
    { id: 'core', name: 'Core', modules: [],
      features: ['limit:users.limit', 'limit:storage.limit_mb', 'limit:branches.extra_limit:0', 'boolean:tasks.enabled', 'boolean:chat.enabled',
        'boolean:meetings.enabled', 'boolean:documents.enabled', 'boolean:operations.enabled', 'boolean:ai.enabled', 'boolean:ai.knowledge'] },
    { id: 'projects', name: 'Projects', sellable: true, modules: ['liwan_pmo'], features: ['boolean:pmo.enabled', 'boolean:pmo.change_control', 'boolean:pmo.baselines', 'boolean:pmo.evm', 'limit:projects.max_projects'] },
    { id: 'people', name: 'People', sellable: true, modules: ['liwan_hr'], features: ['boolean:hr.enabled', 'boolean:hr.recruitment', 'boolean:hr.shifts', 'boolean:hr.onboarding', 'boolean:hr.offboarding', 'boolean:hr.assets', 'boolean:hr.warnings', 'boolean:hr.insurance', 'boolean:hr.payroll'] },
    { id: 'finance', name: 'Finance', sellable: true, modules: ['liwan_finance'], features: ['boolean:finance.enabled'] },
    { id: 'integrations', name: 'Saudi integrations', sellable: true, modules: ['liwan_integrations_sa'], features: ['boolean:integrations.enabled'] },
    { id: 'payments', name: 'Online payments', sellable: true, modules: ['liwan_payments'], features: ['boolean:payments.enabled'] },
    { id: 'crm', name: 'CRM', sellable: true, modules: ['liwan_crm'], features: ['boolean:crm.enabled', 'boolean:crm.import', 'boolean:crm.export'] },
    { id: 'appointments', name: 'Appointments', sellable: true, modules: ['liwan_appointments'], features: ['boolean:appointments.enabled'] },
    { id: 'inbox', name: 'Customer Inbox', sellable: true, modules: ['liwan_inbox', 'liwan_inbox_payments'],
      features: ['boolean:inbox.enabled', 'boolean:inbox.whatsapp', 'boolean:inbox.tiktok', 'boolean:inbox.templates', 'boolean:inbox.automation', 'boolean:inbox.flows', 'boolean:inbox.reports', 'boolean:inbox.catalog', 'boolean:inbox.campaigns', 'limit:inbox.channels', 'limit:inbox.messages_out', 'limit:inbox.campaign_recipients'] },
  ]
  return { schema_version: 3, descriptor_grammar: 'limit:key | limit:key:<int> | boolean:key', id: 'engine_fixture', name: 'Engine fixture', industry: 'none',
    base_modules: ['liwan_core', 'liwan_platform', 'liwan_api'], tiers }
}
export async function setup(pool: Pool) {
  await migrate(pool)
  const solution = engineSolution()
  const version = `commercial-${randomUUID()}`
  await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), version, solution, createHash('sha256').update(JSON.stringify(solution)).digest('hex')])
  return { version, solution }
}
export function client(pool: Pool, caps: any[] = ALL, issuer = 'commercial-test') {
  return async (method: string, path: string, body?: unknown) => {
    const [pathname, search] = path.split('?')
    try {
      const r = await commercialHttp(pool, { method, pathname: `/v1/commercial${pathname}`, search: search ? `?${search}` : '', raw: body === undefined ? '' : JSON.stringify(body), issuer, actor: 7, capabilities: caps, stepUpFresh: true })
      return { status: r!.status, body: r!.data as any }
    } catch (e) {
      if (e instanceof CommercialHttpError) return { status: e.status, body: { code: e.code, field: e.field, issues: e.issues } as any }
      throw e
    }
  }
}
export const money = (minor: number) => ({ currency: 'SAR', exponent: 2, minor })
export const monthly = { unit: 'month' as const, count: 1 }
