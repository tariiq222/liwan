import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { cadenceLabel } from '@liwan/commercial-ui/app/utils/commercial'
import { cadenceKey, commercialErrorKey, lifecycleStatus } from '../../utils/vendorCommercial'
import { planRequestBody, planTenantQuoteBody } from '../../utils/vendorTenantPlan'
import { loadSfc } from './sfc'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const useI18n = () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key) })
const monthly = { unit: 'month' as const, count: 1 }
const plan = (over: Record<string, unknown> = {}) => ({ id: 'p1', name: 'Starter', status: 'published', available: true, trial_days: 14, prices: [{ cadence: monthly, amount: { currency: 'SAR', exponent: 2, minor: 100 } }], included_bundle_revision_ids: ['b1'], included_users: 3, included_storage_mb: 5120, ...over })

describe('trial start panel', () => {
  const startTrial = vi.fn()
  const sfc = loadSfc('components/vendor/TrialStartPanel.vue', { useI18n, useHydrated: () => Vue.ref(true), useVendorSubscriptions: () => ({ startTrial }), cadenceLabel, cadenceKey, commercialErrorKey, lifecycleStatus, planRequestBody })
  it('offers only published plans that include trial days', async () => {
    const setup = sfc.setup({ customerId: 'c1', plans: [plan(), plan({ id: 'p2', trial_days: 0 }), plan({ id: 'p3', status: 'draft' })] })
    expect(setup.trialPlans.value.map((p: { id: string }) => p.id)).toEqual(['p1'])
  })
  it('says no plan offers a trial instead of showing an empty form', async () => {
    const html = await sfc.html({ customerId: 'c1', plans: [plan({ trial_days: 0 })] })
    expect(html).toContain('vendor.customers.trialStart.noPlans')
    expect(html).not.toContain('<form')
  })
  it('names the trial length on the action only once a plan is chosen', async () => {
    expect(await sfc.html({ customerId: 'c1', plans: [plan()] })).toContain('vendor.customers.trialStart.title')
  })
  it('starts the trial with the plan, its included bundles and the chosen cadence, then reports done', async () => {
    const emit = vi.fn()
    const setup = sfc.setup({ customerId: 'c1', plans: [plan()] }, emit)
    setup.planId.value = 'p1'; await Vue.nextTick(); setup.cadence.value = cadenceKey(monthly)
    await setup.start()
    expect(startTrial).toHaveBeenCalledWith('c1', { kind: 'new', plan_revision_id: 'p1', bundle_revision_ids: ['b1'], cadence: monthly, requested_extra_branches: 0, requested_users: 3, requested_storage_mb: 5120 })
    expect(emit).toHaveBeenCalledWith('done')
  })
  it('shows the server refusal through the vendor error map and does not report done', async () => {
    startTrial.mockRejectedValueOnce({ data: { code: 'trial_already_used' }, statusCode: 409 })
    const emit = vi.fn()
    const setup = sfc.setup({ customerId: 'c1', plans: [plan()] }, emit)
    setup.planId.value = 'p1'; await Vue.nextTick(); setup.cadence.value = cadenceKey(monthly)
    await setup.start()
    expect(setup.failure.value).toBe('vendor.pricing.errors.trial_already_used')
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('trial start wiring', () => {
  const root = resolve(import.meta.dirname, '../..')
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
  it('builds the same request body for a quote and for a trial', () => {
    const { kind, ...rest } = planRequestBody(plan() as never, monthly)
    expect(planTenantQuoteBody('c1', plan() as never, monthly)).toEqual({ customer_id: 'c1', kind, ...rest })
  })
  it('maps the paid-first refusal to its own message', () => {
    expect(commercialErrorKey({ data: { code: 'trial_required_first' }, statusCode: 409 })).toBe('vendor.pricing.errors.trial_required_first')
  })
  it('posts to the vendor trial route and shows the panel only to a manager of a customer without a subscription', () => {
    expect(read('composables/useVendorSubscriptions.ts')).toContain('commercial/customers/${seg(customerId)}/trial')
    const page = read('pages/customers/[id].vue')
    expect(page).toContain('<VendorTrialStartPanel v-if="canStartTrial"')
    expect(page).toMatch(/canStartTrial = computed\(\(\) => can\('vendor.subscriptions.manage'\) && \(hasWorkspace.value \|\| can\('vendor.tenants.manage'\)\) && !view.value\?.applied && !view.value\?.pending_order\)/)
  })
})
