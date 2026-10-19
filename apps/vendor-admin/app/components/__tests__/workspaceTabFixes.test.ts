import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { cadenceLabel, formatCommercialMoney } from '@webvue/commercial-ui/app/utils/commercial'
import { invoiceStatusBadge } from '@webvue/commercial-ui/app/utils/commercialBadges'
import { formatWebVueDate } from '@webvue/ui/app/composables/calendarDate'
import { sharedTenantLoginUrl } from '../../composables/useSharedTenantOnboarding'
import * as subscriptions from '../../utils/vendorSubscriptions'
import { customerDisplayBadge, operationStatusBadge } from '../../utils/vendorBadges'
import { buildVendorPolicy } from '../../utils/vendorPolicy'
import { loadSfc, stripImports, vueApi } from './sfc'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'

const useI18n = () => ({ t: (key: string) => key, locale: Vue.ref('en') })

describe('provisioning steps', () => {
  const steps = loadSfc('components/vendor/ProvisioningSteps.vue', { useI18n })
  const states = async (props: Record<string, unknown>) => {
    const html = await steps.html(props)
    return { html, states: [...html.matchAll(/data-state="(\w+)"/g)].map(match => match[1]), note: /data-note="(\w+)"/.exec(html)?.[1] }
  }
  it('says a stage that needs follow-up in words and marks no step as failed or current', async () => {
    const result = await states({ stage: 'needs_intervention', failed: true })
    expect(result.note).toBe('needs_intervention')
    expect(result.html).toContain('vendor.tenants.provisioning.stages.needs_intervention')
    expect(result.states).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
  })
  it('says an unreported stage is in progress instead of marking the first step current', async () => {
    const result = await states({ stage: 'pending' })
    expect(result.note).toBe('pending')
    expect(result.html).toContain('vendor.tenants.provisioning.stages.pending')
    expect(result.states).toEqual(['pending', 'pending', 'pending', 'pending', 'pending'])
  })
  it('marks the step that actually failed and keeps the ones before it done', async () => {
    const result = await states({ stage: 'verifying', failed: true })
    expect(result.states).toEqual(['done', 'done', 'failed', 'pending', 'pending'])
    expect(result.note).toBeUndefined()
  })
  it('shows the running step as current and a finished workspace as done', async () => {
    expect((await states({ stage: 'queued' })).states).toEqual(['done', 'current', 'pending', 'pending', 'pending'])
    expect((await states({ stage: 'active' })).states).toEqual(['done', 'done', 'done', 'done', 'done'])
  })
})

describe('provisioning poll', () => {
  afterEach(() => { vi.useRealTimers() })
  function mount(polling: { value: boolean }) {
    vi.useFakeTimers()
    const refresh = vi.fn(async () => {})
    const data = Vue.ref({ tenant_id: 't', job_id: 'j', status: 'provisioning', host: null, admin_login: null, stage: 'verifying', error_code: null })
    const source = stripImports(readFileSync(resolve(import.meta.dirname, '../../composables/useWorkspaceProvisioning.ts'), 'utf8')).replace('export function', 'function').replace('export type WorkspaceProvisioning = ReturnType<typeof useWorkspaceProvisioning>', '')
    const bindings = { ...vueApi, toValue: Vue.toValue, sharedTenantLoginUrl, useVendorApi: () => ({ request: vi.fn() }), useVendorContext: () => ({ sharedOnboardingEnabled: Vue.ref(true) }), useAsyncData: () => ({ data, error: Vue.ref(null), pending: Vue.ref(false), refresh }), onMounted: (fn: () => void) => fn(), onBeforeUnmount: () => {} }
    const code = ts.transpileModule(`${source.replaceAll('import.meta.client', 'true')}\nreturn useWorkspaceProvisioning(id, polling)`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
    const poll = new Function(...Object.keys(bindings), 'id', 'polling', code)(...Object.values(bindings), Vue.ref('t'), () => polling.value)
    return { poll, refresh }
  }
  it('does not poll while the page is on a tab that does not need it, and resumes when it does', async () => {
    const polling = Vue.reactive({ value: false })
    const { refresh } = mount(polling)
    await vi.advanceTimersByTimeAsync(30000)
    expect(refresh).not.toHaveBeenCalled()
    polling.value = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(1)
    polling.value = false
    await vi.advanceTimersByTimeAsync(30000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
  it('counts one limit, pauses at it, and a manual refresh resets that single counter', async () => {
    const { poll, refresh } = mount(Vue.reactive({ value: true }))
    await vi.advanceTimersByTimeAsync(5000 * 70)
    expect(refresh).toHaveBeenCalledTimes(60)
    expect(poll.pollingPaused).toBe(true)
    await poll.refreshNow()
    expect(poll.pollingPaused).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(62)
  })
})

describe('customer glance', () => {
  const glance = loadSfc('components/vendor/CustomerGlance.vue', { useI18n, cadenceLabel, formatCommercialMoney, invoiceStatusBadge, formatWebVueDate, customerDisplayBadge, ...subscriptions })
  const base = { setupRequired: false, subscription: null, hasWorkspace: true, workspaceBadge: null, provisioningFailed: false, operationFailed: false, workspaceUnreadable: false, invoicesOffered: true, loginUrl: null, tabTo: (tab: string) => `/c?tab=${tab}` }
  const pastDue = { id: 's', state: 'past_due', applied: null, target: null, pending_order: null, revision: 1, auto_renew: { enabled: false } }
  it('never says there are no problems while the workspace state could not be read, and offers a retry', async () => {
    const html = await glance.html({ ...base, workspaceUnreadable: true })
    expect(html).not.toContain('vendor.customers.glance.noIssues')
    expect(html).toContain('vendor.customers.glance.unreadable')
    expect(html).toContain('data-testid="glance-unreadable"')
    expect(await glance.html(base)).toContain('vendor.customers.glance.noIssues')
  })
  it('links the past-due issue to the invoices tab only when that tab is offered', async () => {
    const offered = await glance.html({ ...base, subscription: pastDue })
    expect(offered).toContain('vendor.customers.glance.issues.pastDue')
    expect(offered).toContain('/c?tab=invoices')
    const hidden = await glance.html({ ...base, subscription: pastDue, invoicesOffered: false })
    expect(hidden).toContain('vendor.customers.glance.issues.pastDue')
    expect(hidden).not.toContain('/c?tab=invoices')
    expect(hidden).not.toContain('vendor.clientTabs.invoices')
  })
})

describe('workspace panel', () => {
  const progress = { provisioning: null, error: null, pending: false, loginUrl: null, failed: false, stage: 'pending', pollingPaused: false, refreshNow: vi.fn() }
  const tenant = { desired_policy: {}, observed_policy: {} }
  const panel = (enabled: boolean) => loadSfc('components/vendor/WorkspacePanel.vue', { useI18n, useHydrated: () => Vue.ref(true), useVendorContext: () => ({ sharedOnboardingEnabled: Vue.ref(enabled) }) })
  it('hides the provisioning section when shared onboarding is off and shows it when on', async () => {
    expect(await panel(false).html({ tenant, progress })).not.toContain('vendor.tenants.provisioning.title')
    expect(await panel(true).html({ tenant, progress })).toContain('vendor.tenants.provisioning.title')
  })
  it('renders the policy once, without its own tenant error block', async () => {
    const html = await panel(true).html({ tenant, progress })
    expect(html).toContain('vendor.tenants.policyTitle')
    expect(html).not.toContain('SharedPageState')
  })
})

describe('operations panel enqueue confirmation', () => {
  const tenant = Vue.ref({ operations_enabled: true, available_operations: ['tenant.entitle'], observed_policy: { 'users.limit': 5 }, desired_policy: {}, policy_revision: 3, catalog_version: '1', catalog_tier: 'x', status: 'active' })
  const mount = () => loadSfc('components/vendor/TenantOperationsPanel.vue', {
    useI18n, formatWebVueDateTime: () => '', operationStatusBadge, buildVendorPolicy, navigateTo: vi.fn(),
    _useModel: () => Vue.ref(false), onBeforeUnmount: () => {},
    useVendorApi: () => ({ request: vi.fn() }), useVendorContext: () => ({ can: () => true }),
    useVendorTenant: () => ({ data: tenant, error: Vue.ref(null), pending: Vue.ref(false), refresh: vi.fn() }),
    useTenantRecentOperations: () => ({ data: Vue.ref([]), error: Vue.ref(null), pending: Vue.ref(false), refresh: vi.fn() }),
    useAsyncData: () => ({ data: Vue.ref({ items: [], total: 0 }) }),
  }).setup({ tenantId: 't' })
  it('closes when a limit changes, when a switch changes, or when the reason changes', async () => {
    const state = mount()
    for (const change of [() => { state.edits['users.limit'] = '9' }, () => { state.edits['users.limit'] = '10' }, () => { state.reason.value = 'because' }]) {
      state.confirmEnqueue.value = true
      change()
      await Vue.nextTick()
      expect(state.confirmEnqueue.value).toBe(false)
    }
  })
})
