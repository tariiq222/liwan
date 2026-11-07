import { describe, expect, it } from 'vitest'
import { emptyLimit, emptyPlanDraft, planDraftFromView, planEditPayload, AI_LIMIT_KEYS, aiLimitsFromDraft, planLimits } from '../vendorCommercial'

/** W8 (owner decision 2026-11-06): the AI assistant's monthly budget is a vendor-editable plan value. */
const view = {
  id: '00000000-0000-4000-8000-000000000001', plan_id: '00000000-0000-4000-8000-000000000002', version: 1, edit_revision: 3,
  name: 'LiwanOS', status: 'published', available: true, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
  prices: [{ cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 0 } }],
  platform_limits: { 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 },
  included_bundle_revision_ids: [], optional_bundle_revision_ids: [], included_extra_branches: 1, extra_branch_prices: [],
  storage_step_mb: 10240, storage_step_threshold_mb: 102400, storage_large_step_mb: 102400,
  extra_branches_limit: null, included_users: 3, included_storage_mb: 5120,
  user_prices: [{ cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 2900 } }],
  storage_prices: [{ cadence: { unit: 'month', count: 1 }, amount: { currency: 'SAR', exponent: 2, minor: 100 } }],
  policy_revision_id: '00000000-0000-4000-8000-000000000006', trial_days: 14, grace_days: 7, auto_suspend: true, auto_renew_allowed: true,
  content_digest: 'a'.repeat(64), validated_digest: null, customer_count: 0, created_at: '2026-11-06T00:00:00.000Z', published_at: null,
} as never

describe('AI limits on the plan form', () => {
  it('lists the five limits the AI addon registers', () => {
    expect(AI_LIMIT_KEYS).toEqual(['ai.messages.monthly', 'ai.tokens.monthly', 'ai.assist.monthly', 'ai.tool_calls.per_run', 'ai.output_tokens.per_run'])
  })

  it('loads the limits of the plan being edited', () => {
    const draft = planDraftFromView(view)
    expect(draft.ai_limits).toEqual({
      'ai.messages.monthly': { mode: 'number', value: '500' },
      'ai.tokens.monthly': { mode: 'number', value: '2500000' },
      'ai.assist.monthly': { mode: 'number', value: '100' },
      'ai.tool_calls.per_run': { mode: 'number', value: '8' },
      'ai.output_tokens.per_run': { mode: 'number', value: '2000' },
    })
  })

  it('starts every limit empty in a new plan, meaning unlimited', () => {
    const draft = emptyPlanDraft()
    expect(Object.keys(draft.ai_limits).sort()).toEqual([...AI_LIMIT_KEYS].sort())
    expect(Object.values(draft.ai_limits).every(limit => limit.mode === '' && limit.value === '')).toBe(true)
    expect(aiLimitsFromDraft(draft.ai_limits)).toEqual(Object.fromEntries(AI_LIMIT_KEYS.map(key => [key, null])))
  })

  it('reads an unlimited limit as null and a number as itself', () => {
    expect(aiLimitsFromDraft({ 'ai.messages.monthly': { mode: 'unlimited', value: '' }, 'ai.tokens.monthly': { mode: 'number', value: '2500000' } }))
      .toEqual({ 'ai.messages.monthly': null, 'ai.tokens.monthly': 2500000 })
  })

  it('refuses a negative, fractional or non-numeric value', () => {
    for (const value of ['-1', '1.5', 'abc', ' ', '1e3']) {
      expect(() => aiLimitsFromDraft({ 'ai.messages.monthly': { mode: 'number', value } })).toThrow('invalid_limit')
    }
  })

  it('saves the limits in platform_limits, next to nothing it must not derive', () => {
    const draft = planDraftFromView(view)
    const payload = planEditPayload({ ...draft, reason: 'Tighten the AI budget' }, '00000000-0000-4000-8000-000000000006', 3)
    expect(payload.platform_limits).toEqual({ 'ai.messages.monthly': 500, 'ai.tokens.monthly': 2500000, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 })
    // Users, storage and branches are quantities the customer chooses, never plan limits.
    for (const derived of ['users.limit', 'storage.limit_mb', 'branches.extra_limit']) expect(payload.platform_limits).not.toHaveProperty(derived)
  })

  it('round-trips a plan created with limits, clearing only the ones the vendor empties', () => {
    const draft = planDraftFromView(view)
    const saved = planLimits({ ...draft, ai_limits: { ...draft.ai_limits, 'ai.messages.monthly': emptyLimit(), 'ai.tokens.monthly': { mode: 'unlimited', value: '' } } })
    expect(saved).toEqual({ 'ai.messages.monthly': null, 'ai.tokens.monthly': null, 'ai.assist.monthly': 100, 'ai.tool_calls.per_run': 8, 'ai.output_tokens.per_run': 2000 })
  })
})
