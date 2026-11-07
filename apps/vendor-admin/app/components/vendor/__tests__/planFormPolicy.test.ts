import { describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import * as selection from '../policySelection'

const { approvedPolicies, defaultPolicyId, policyOptions } = selection
import type { PricingPolicyView } from '../../../composables/useVendorCommercial'
import * as commercial from '../../../utils/vendorCommercial'
import { handleCommercial } from '../../../../e2e/commercial-mock-routes.mjs'
import { loadSfc } from '../../__tests__/sfc'

// schema_012.sql inserts both approved policies in ONE statement, so they share created_at and the policies endpoint orders
// by created_at,id: the VAT row (…0001) sorts first. This is the exact production ordering the form must survive.
const VAT_ID = '6f1c3d8e-0000-4000-8000-000000000001'
const NO_TAX_ID = '6f1c3d8e-0000-4000-8000-000000000002'
const vat: PricingPolicyView = { id: VAT_ID, timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'vat_exclusive', rate_bps: 1500 } }
const noTax: PricingPolicyView = { id: NO_TAX_ID, timezone: 'Asia/Riyadh', rounding: 'half_up_per_line', tax: { kind: 'none' } }
/** The production list: VAT first. */
const approvedVatFirst = [vat, noTax]

/** A revision id that passes the contract's uuid check. */
const BUNDLE_ID = '00000000-0000-4000-8000-000000000005'

/** A saved draft plan, the shape planDraftFromView reads; only the policy differs between cases. */
const savedPlan = (policyId: string) => ({
  id: 'plan-1', plan_id: 'plan-1', version: 1, edit_revision: 1, status: 'draft', available: false,
  name: 'P', audience: { kind: 'public' as const }, term_months: 12, prices: [], included_bundle_revision_ids: [], optional_bundle_revision_ids: [],
  included_users: 3, included_storage_mb: 5120, storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
  user_prices: [], storage_prices: [], included_extra_branches: 0, extra_branch_prices: [], extra_branches_limit: null,
  platform_limits: {}, trial_days: 0, grace_days: 7, auto_suspend: true, auto_renew_allowed: false, policy_revision_id: policyId,
})

const useI18n = () => ({ t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key), locale: Vue.ref('en') })
// The form's auto-imported helpers, handed to the SFC harness as the app's own Nuxt import resolver would.
const form = () => loadSfc('components/vendor/PlanForm.vue', { useI18n, useHydrated: () => Vue.ref(true), ...commercial, ...selection })

/** Mounts the form's setup() and fills every required value except the policy under test, field by field as the vendor would. */
function fillDraft(draft: any) {
  const row = (amount: string) => ({ unit: 'month', count: '1', amount })
  draft.name = 'P'; draft.term_months = '12'; draft.included = [BUNDLE_ID]
  draft.prices = [row('100')]; draft.user_prices = [row('25')]; draft.storage_prices = [row('5')]; draft.extra_branch_prices = [row('20')]
  draft.included_users = '3'; draft.included_storage_mb = '5120'; draft.included_extra_branches = '0'
  draft.extra_branches_limit.mode = 'unlimited'
  draft.trial_days = '0'; draft.grace_days = '7'; draft.auto_suspend = 'true'; draft.auto_renew_allowed = 'false'; draft.reason = 'سبب'
}
function filledSetup(props: Record<string, unknown>, emit: (...args: unknown[]) => void = () => {}) {
  const setup = form().setup(props, emit)
  fillDraft(setup.draft)
  return setup
}

describe('approved pricing policies never default to the first listed row', () => {
  it('keeps every approved policy of the list envelope instead of only its first item', () => {
    expect(approvedPolicies({ items: approvedVatFirst })).toEqual(approvedVatFirst)
    expect(approvedPolicies({ items: approvedVatFirst })).not.toEqual([vat])
  })
  it('defaults to the no-tax policy even when the VAT policy is listed first (production ordering)', () => {
    expect(defaultPolicyId(approvedVatFirst)).toBe(NO_TAX_ID)
  })
  it('yields the no-tax id from a VAT-first list and from any other placement', () => {
    expect(defaultPolicyId([vat, noTax])).toBe(NO_TAX_ID)
    expect(defaultPolicyId([noTax, vat])).toBe(NO_TAX_ID)
    expect(defaultPolicyId([vat, noTax, { ...vat, id: 'third-vat' }])).toBe(NO_TAX_ID)
  })
  it('preselects nothing when only a VAT policy is approved', () => {
    expect(defaultPolicyId([vat])).toBeUndefined()
    expect(defaultPolicyId([])).toBeUndefined()
  })
  it('lists the no-tax policy first so the default is also the visible first choice', () => {
    const labels: Record<string, string> = { [VAT_ID]: 'VAT 15% exclusive', [NO_TAX_ID]: 'No tax' }
    const options = policyOptions(approvedVatFirst, p => labels[p.id]!)
    expect(options).toEqual([{ label: 'No tax', value: NO_TAX_ID }, { label: 'VAT 15% exclusive', value: VAT_ID }])
  })
})

describe('plan form pricing policy selection', () => {
  it('preselects the no-tax policy on a new plan while VAT is listed first', () => {
    const setup = form().setup({ bundles: [], policies: approvedVatFirst })
    expect(setup.draft.policy_revision_id).toBe(NO_TAX_ID)
    expect(setup.taxText.value).toBe('vendor.pricing.plan.noTax')
  })
  it('shows VAT wording only after the vendor selects the VAT policy, and the no-tax wording again on switching back', () => {
    const setup = form().setup({ bundles: [], policies: approvedVatFirst })
    expect(setup.taxText.value).not.toContain('vat')
    setup.draft.policy_revision_id = VAT_ID
    expect(setup.taxText.value).toBe('vendor.pricing.plan.vat:{"rate":15}')
    setup.draft.policy_revision_id = NO_TAX_ID
    expect(setup.taxText.value).toBe('vendor.pricing.plan.noTax')
  })
  it('preselects nothing and shows no tax wording when only a VAT policy is approved', () => {
    const setup = form().setup({ bundles: [], policies: [vat] })
    expect(setup.draft.policy_revision_id).toBe('')
    expect(setup.taxText.value).toBeNull()
  })
  it('refuses to save an unselected policy rather than falling back to VAT', () => {
    const emit = vi.fn()
    const setup = filledSetup({ bundles: [], policies: [vat] }, emit)
    expect(setup.draft.policy_revision_id).toBe('')
    setup.submit()
    expect(emit).not.toHaveBeenCalled()
    expect(setup.errors.value.policy).toBe('vendor.pricing.plan.policyRequired')
  })
  it('falls back to the single supplied policy prop when no list is given', () => {
    expect(form().setup({ bundles: [], policy: noTax }).draft.policy_revision_id).toBe(NO_TAX_ID)
    expect(form().setup({ bundles: [], policy: vat }).draft.policy_revision_id).toBe('')
  })
  it('keeps the plan’s own policy on an edit, and clears the selection when it is no longer approved', () => {
    expect(form().setup({ bundles: [], policies: approvedVatFirst, initial: savedPlan(NO_TAX_ID) }).draft.policy_revision_id).toBe(NO_TAX_ID)
    expect(form().setup({ bundles: [], policies: approvedVatFirst, initial: savedPlan(VAT_ID) }).draft.policy_revision_id).toBe(VAT_ID)
    expect(form().setup({ bundles: [], policies: [vat], initial: savedPlan(NO_TAX_ID) }).draft.policy_revision_id).toBe('')
  })
  it('saves the selected policy id in the draft the page turns into the plan payload', () => {
    const emit = vi.fn()
    const setup = filledSetup({ bundles: [], policies: approvedVatFirst }, emit)
    setup.draft.policy_revision_id = NO_TAX_ID
    setup.submit()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('save', expect.objectContaining({ name: 'P', policy_revision_id: NO_TAX_ID }))

    const vatEmit = vi.fn()
    const vatSetup = filledSetup({ bundles: [], policies: approvedVatFirst }, vatEmit)
    vatSetup.draft.policy_revision_id = VAT_ID
    vatSetup.submit()
    expect(vatEmit).toHaveBeenCalledWith('save', expect.objectContaining({ policy_revision_id: VAT_ID }))
  })
  it('renders the policy selector and summarizes the no-tax policy, without any VAT wording, before a VAT choice', async () => {
    const html = await form().html({ bundles: [], policies: approvedVatFirst })
    expect(html).toContain('vendor.pricing.policy.select')
    expect(html).toContain('vendor.pricing.policy.tax')
    expect(html).toContain('<dd>vendor.pricing.plan.noTax</dd>')
    expect(html).not.toContain('vendor.pricing.plan.vat')
    expect(html).not.toContain('vendor.pricing.plan.policyMissing')
  })
  it('shows no tax wording at all when only a VAT policy exists and nothing is preselected', async () => {
    const html = await form().html({ bundles: [], policies: [vat] })
    expect(html).toContain('vendor.pricing.policy.select')
    expect(html).not.toContain('vendor.pricing.plan.vat')
    expect(html).not.toContain('vendor.pricing.plan.noTax')
    expect(html).toContain('<dd>—</dd>')
  })
  it('sends the selected id through planCreatePayload as policy_revision_id', () => {
    const emit = vi.fn()
    const setup = filledSetup({ bundles: [], policies: approvedVatFirst }, emit)
    setup.submit()
    const [, draft] = emit.mock.calls[0]! as [string, ReturnType<typeof commercial.emptyPlanDraft>]
    expect(draft.policy_revision_id).toBe(NO_TAX_ID)
    expect(commercial.planCreatePayload(draft, draft.policy_revision_id).policy_revision_id).toBe(NO_TAX_ID)
  })
})

describe('the e2e mock reflects the production policy list', () => {
  /** The stub control plane answers through its real handler, so the test reads what a page would be served. */
  function policiesFromMock() {
    let body: { items: PricingPolicyView[]; total: number } | undefined
    const response = { writeHead: () => {}, end: (raw: string) => { body = JSON.parse(raw) } }
    handleCommercial({ method: 'GET' }, response, new URL('/v1/commercial/policies', 'http://localhost'))
    return body!
  }

  it('serves both approved policies with VAT first, so the default is genuinely exercised', () => {
    const served = policiesFromMock()
    // One row could never exercise the default: both are served, in the production order.
    expect(served.total).toBe(2)
    expect(served.items.map(p => p.tax.kind)).toEqual(['vat_exclusive', 'none'])
  })

  it('opens the plan form on the no-tax policy over the served list, not on its first row', () => {
    const served = policiesFromMock()
    const setup = form().setup({ bundles: [], policies: served.items })
    expect(setup.draft.policy_revision_id).toBe(served.items[1]!.id)
    expect(setup.taxText.value).toBe('vendor.pricing.plan.noTax')
  })

  it('lists the no-tax policy first in the selector', async () => {
    const served = policiesFromMock()
    const { render } = form().mount({ bundles: [], policies: served.items })
    const { captured } = await render()
    const selector = captured.find(c => c.name === 'USelect' && c.attrs['data-testid'] === 'plan-policy')
    expect((selector?.attrs.items as { value: string }[]).map(item => item.value)).toEqual([served.items[1]!.id, served.items[0]!.id])
  })
})

describe('the plan form states the storage steps and the users cap', () => {
  it('validates the users cap above 100 instead of calling it required', () => {
    // `parseCount(x, 100)` used to return null above the cap, so 150 read as «مطلوب» and the cap message never showed.
    const setup = filledSetup({ bundles: [], policies: approvedVatFirst, policy: noTax })
    setup.draft.included_users = '150'
    expect(setup.errors.value.includedUsers).toBe('vendor.pricing.plan.usersCapExceeded')
    setup.draft.included_users = '100'
    expect(setup.errors.value.includedUsers).toBeUndefined()
    setup.draft.included_users = ''
    expect(setup.errors.value.includedUsers).toBe('vendor.pricing.plan.usersRequired')
  })

  it('requires the three storage steps and refuses a misaligned set', () => {
    const setup = filledSetup({ bundles: [], policies: approvedVatFirst, policy: noTax })
    setup.draft.storage_step_mb = ''
    expect(setup.errors.value.storage_step_mb).toBe('vendor.pricing.required')
    // 10 GiB step with a 15 GiB threshold: 20 GiB would be unbuyable while 10 GiB is fine.
    Object.assign(setup.draft, { storage_step_mb: '10240', storage_step_threshold_mb: '15360', storage_large_step_mb: '102400' })
    expect(setup.errors.value.storage_step_threshold_mb).toBe('vendor.pricing.plan.storageStepMisaligned')
    // The seeded, aligned values pass.
    Object.assign(setup.draft, { storage_step_mb: '10240', storage_step_threshold_mb: '102400', storage_large_step_mb: '102400' })
    expect(setup.errors.value.storage_step_threshold_mb).toBeUndefined()
  })

  it('refuses a step larger than the integer column allows', () => {
    const setup = filledSetup({ bundles: [], policies: approvedVatFirst, policy: noTax })
    setup.draft.storage_step_mb = String(Number.MAX_SAFE_INTEGER)
    expect(setup.errors.value.storage_step_mb).toBe('vendor.pricing.plan.storageStepTooLarge')
  })
})

describe('the three storage step inputs', () => {
  const STEP = 'vendor.pricing.fields.storageStep', THRESHOLD = 'vendor.pricing.fields.storageStepThreshold', LARGE = 'vendor.pricing.fields.storageLargeStep'
  type Rendered = { name: string; attrs: Record<string, any> }[]
  /** A field's wrapper is rendered right before its control, so the control is the next input after the labelled wrapper. */
  const field = (captured: Rendered, label: string) => {
    const at = captured.findIndex(c => c.name === 'UFormField' && c.attrs.label === label)
    return { wrapper: captured[at]!, input: captured.slice(at + 1).find(c => c.name === 'UInput')! }
  }
  const mounted = (props: Record<string, unknown> = {}, emit: (...args: unknown[]) => void = () => {}) => {
    const m = form().mount({ bundles: [], policies: approvedVatFirst, ...props }, emit)
    fillDraft(m.state.draft)
    return m
  }
  /** What the vendor does: type into the control. The control's own update listener is what the template wired. */
  const type = async (m: ReturnType<typeof mounted>, label: string, text: string) => {
    ;(field((await m.render()).captured, label).input.attrs['onUpdate:modelValue'] as (v: string) => void)(text)
  }

  it('renders the step, threshold and large-step inputs as required numeric fields with their seeded values and hints', async () => {
    const { captured } = await mounted().render()
    for (const [label, value] of [[STEP, '10240'], [THRESHOLD, '102400'], [LARGE, '102400']] as const) {
      const { wrapper, input } = field(captured, label)
      expect(wrapper, label).toBeDefined(); expect(input, label).toBeDefined()
      expect(wrapper.attrs.required, label).toBeDefined()
      expect(wrapper.attrs.help, label).toBe(`${label}Hint`)
      expect(input.attrs.modelValue, label).toBe(value)
      expect(input.attrs.inputmode, label).toBe('numeric')
      expect(input.attrs.dir, label).toBe('ltr')
    }
  })

  it('accepts Arabic-Indic digits in all three inputs and saves, instead of reading them as NaN and calling them misaligned', async () => {
    const emit = vi.fn()
    const m = mounted({}, emit)
    await type(m, STEP, '١٠٢٤٠'); await type(m, THRESHOLD, '١٠٢٤٠٠'); await type(m, LARGE, '١٠٢٤٠٠')
    expect(m.state.errors.value.storage_step_mb).toBeUndefined()
    expect(m.state.errors.value.storage_step_threshold_mb).toBeUndefined()
    expect(m.state.errors.value.storage_large_step_mb).toBeUndefined()
    m.state.submit()
    expect(emit).toHaveBeenCalledWith('save', expect.objectContaining({ storage_step_mb: '١٠٢٤٠' }))
    // The payload the page sends reads the same digits.
    expect(commercial.planCreatePayload(emit.mock.calls[0]![1] as never, NO_TAX_ID).storage_step_mb).toBe(10240)
  })

  it('still reports a genuinely misaligned set written with Arabic-Indic digits, on the threshold field', async () => {
    const m = mounted()
    await type(m, STEP, '١٠٢٤٠'); await type(m, THRESHOLD, '١٥٣٦٠')
    m.state.submit()
    expect(field((await m.render()).captured, THRESHOLD).wrapper.attrs.error).toBe('vendor.pricing.plan.storageStepMisaligned')
  })

  it('calls a step of 0 required, not misaligned', async () => {
    const m = mounted()
    for (const [label, key] of [[STEP, 'storage_step_mb'], [THRESHOLD, 'storage_step_threshold_mb'], [LARGE, 'storage_large_step_mb']] as const) {
      await type(m, label, '0')
      expect(m.state.errors.value[key], key).toBe('vendor.pricing.required')
      await type(m, label, '١٠٢٤٠')
    }
    m.state.submit()
    const { captured } = await m.render()
    expect(field(captured, STEP).wrapper.attrs.error).toBeUndefined()
  })

  it.each([
    ['storage_step_misaligned', 'storage_step_threshold_mb', THRESHOLD],
    ['storage_step_invalid', 'storage_step_mb', STEP],
    ['storage_step_invalid', 'storage_large_step_mb', LARGE],
  ])('shows the structured server error %s on the %s input', async (code, fieldName, label) => {
    const m = mounted({ error: { statusCode: 422, data: { code, field: fieldName, message: 'refused' } } })
    const { wrapper } = field((await m.render()).captured, label)
    expect(wrapper.attrs.error).toBe(`vendor.pricing.errors.${code}`)
    // Only the named input carries it.
    for (const other of [STEP, THRESHOLD, LARGE].filter(l => l !== label)) expect(field((await m.render()).captured, other).wrapper.attrs.error, other).toBeUndefined()
  })
})
