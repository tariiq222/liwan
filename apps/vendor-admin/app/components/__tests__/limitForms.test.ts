import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { PricingPolicyView } from '../../composables/useVendorCommercial'
import { mountPage } from '../../__tests__/pageHarness'
import { latinDigits } from '../../utils/digits'
import { ownerOnlyAccess } from '../../utils/ownerOnly'
import { MB_PER_GB } from '../../utils/storage'
import * as commercial from '../../utils/vendorCommercial'
import { customerQuoteBody, customersReturnTo, emptyTermsDraft, hasTermsOverride, termsOnly, termsPayload } from '../../utils/vendorSubscriptions'
import * as selection from '../vendor/policySelection'
import { loadSfc } from './sfc'

const useI18n = () => ({
  t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  locale: Vue.ref('en'),
})

const planFormSfc = loadSfc('components/vendor/PlanForm.vue', {
  useI18n,
  useHydrated: () => Vue.ref(true),
  latinDigits,
  MB_PER_GB,
  ...commercial,
  ...selection,
})

const termsFormSfc = loadSfc('components/vendor/CustomerTermsForm.vue', {
  useI18n,
  useHydrated: () => Vue.ref(true),
  ...commercial,
  emptyTermsDraft,
  hasTermsOverride,
})

const NO_TAX_POLICY: PricingPolicyView = {
  id: '6f1c3d8e-0000-4000-8000-000000000002',
  timezone: 'Asia/Riyadh',
  rounding: 'half_up_per_line',
  tax: { kind: 'none' },
}

const BUNDLE_ID = '00000000-0000-4000-8000-000000000005'

function fillPlanDraft(draft: commercial.PlanDraft) {
  const row = (amount: string) => ({ unit: 'month' as const, count: '1', amount })
  draft.name = 'Starter'
  draft.term_months = '12'
  draft.included = [BUNDLE_ID]
  draft.prices = [row('100')]
  draft.user_prices = [row('25')]
  draft.storage_prices = [row('5')]
  draft.extra_branch_prices = [row('20')]
  draft.included_users = '3'
  draft.included_storage_mb = '5120'
  draft.included_extra_branches = '0'
  draft.extra_branches_limit = { mode: 'unlimited', value: '' }
  draft.trial_days = '0'
  draft.grace_days = '7'
  draft.auto_suspend = 'true'
  draft.auto_renew_allowed = 'false'
  draft.reason = 'Initial'
}

describe('PlanForm branch limit messages', () => {
  const BRANCH_LIMIT = 'vendor.pricing.fields.branchLimit'

  async function submitPlanWithLimit(limit: commercial.LimitDraft) {
    const emit = vi.fn()
    const { state, render } = planFormSfc.mount({ bundles: [], policies: [NO_TAX_POLICY] }, emit)
    fillPlanDraft(state.draft)
    state.draft.extra_branches_limit = limit
    state.submit()
    const { captured } = await render()
    const error = captured.find(node => node.name === 'UFormField' && node.attrs.label === BRANCH_LIMIT)?.attrs.error as string | undefined
    return { emit, error }
  }

  it('shows the above-maximum message when extra_branches_limit exceeds MAX_LIMIT', async () => {
    const atMax = await submitPlanWithLimit({ mode: 'number', value: String(commercial.MAX_LIMIT) })
    expect(atMax.error).toBeUndefined()
    expect(atMax.emit).toHaveBeenCalledWith('save', expect.anything())

    const aboveMax = await submitPlanWithLimit({ mode: 'number', value: '1000000001' })
    expect(aboveMax.error).toBe(`vendor.pricing.limit.aboveMax {"max":${commercial.MAX_LIMIT}}`)
    expect(aboveMax.emit).not.toHaveBeenCalled()
  })

  it('keeps the required message for malformed or empty extra_branches_limit values', async () => {
    for (const limit of [
      { mode: 'number', value: 'abc' },
      { mode: 'number', value: '0' },
      { mode: '', value: '' },
    ] satisfies commercial.LimitDraft[]) {
      const { emit, error } = await submitPlanWithLimit(limit)
      expect(error).toBe('vendor.pricing.limit.required')
      expect(emit).not.toHaveBeenCalled()
    }
  })
})

describe('CustomerTermsForm branch limit messages', () => {
  const BRANCH_LIMIT = 'vendor.customers.terms.extraBranchesLimit'

  async function submitTermsWithLimit(limit: commercial.LimitDraft) {
    const emit = vi.fn()
    const { state, render } = termsFormSfc.mount({ canSave: true, canPreview: true }, emit)
    state.draft.extraBranchesLimit = limit
    state.draft.reason = 'Enterprise agreement'
    state.submit()
    const { captured } = await render()
    const error = captured.find(node => node.name === 'UFormField' && node.attrs.label === BRANCH_LIMIT)?.attrs.error as string | undefined
    return { emit, error }
  }

  it('shows the above-maximum message when extraBranchesLimit exceeds MAX_LIMIT', async () => {
    const atMax = await submitTermsWithLimit({ mode: 'number', value: String(commercial.MAX_LIMIT) })
    expect(atMax.error).toBeUndefined()
    expect(atMax.emit).toHaveBeenCalledWith('save', expect.anything())

    const aboveMax = await submitTermsWithLimit({ mode: 'number', value: '1000000001' })
    expect(aboveMax.error).toBe(`vendor.pricing.limit.aboveMax {"max":${commercial.MAX_LIMIT}}`)
    expect(aboveMax.emit).not.toHaveBeenCalled()
  })

  it('keeps the invalid message for malformed extraBranchesLimit values', async () => {
    for (const limit of [
      { mode: 'number', value: 'abc' },
      { mode: 'number', value: '0' },
    ] satisfies commercial.LimitDraft[]) {
      const { emit, error } = await submitTermsWithLimit(limit)
      expect(error).toBe('vendor.pricing.limit.invalid')
      expect(emit).not.toHaveBeenCalled()
    }
  })

  it('maps LimitAboveMax to invalid if it reaches the terms/new page save catch block', async () => {
    const api = {
      customer: vi.fn(async () => ({ id: 'cust-1', subscription: { id: 'sub-1' } })),
      subscription: vi.fn(),
      customerQuote: vi.fn(),
      saveTerms: vi.fn(),
    }
    const page = await mountPage('customers/[id]/terms/new.vue', {
      ownerOnlyAccess,
      commercialErrorKey: commercial.commercialErrorKey,
      commercialFailure: commercial.commercialFailure,
      LimitAboveMax: commercial.LimitAboveMax,
      customerQuoteBody,
      customersReturnTo,
      termsOnly,
      termsPayload,
      useVendorSubscriptions: () => api,
      useVendorContext: () => ({ can: () => true }),
      useRoute: () => ({ params: { id: 'cust-1' }, query: {} }),
      refreshNuxtData: vi.fn(async () => {}),
      navigateTo: vi.fn(),
    })
    try {
      const draft = emptyTermsDraft()
      draft.extraBranchesLimit = { mode: 'number', value: '1000000001' }
      draft.reason = 'Enterprise agreement'
      await page.state.save(draft)
      expect(page.state.saveError.value).toEqual({ code: 'invalid' })
      expect(api.saveTerms).not.toHaveBeenCalled()
    } finally {
      page.stop()
    }
  })
})
