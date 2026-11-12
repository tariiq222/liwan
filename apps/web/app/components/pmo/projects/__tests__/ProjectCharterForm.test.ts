import { describe, expect, it } from 'vitest'
import type { ProjectDetail } from '@liwan/contracts'
import {
  CHARTER_FIELD_KEYS,
  canOverwriteWithLatest,
  draftFromProject,
  isCharterDraftDirty,
  nativeDateSnapshot,
  charterPatchBody,
} from '../../../../utils/projectCharter'

// The form's markup is rendered in ProjectCharterSteps.test.ts and driven end to
// end by e2e/project-charter.spec.ts; what is decided in these helpers is the
// part a screenshot cannot show.
const EMPTY_CHARTER = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], budget_state: 'unknown' as const, amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft' as const,
    approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
    approved_by: null, approved_at: null, return_note: '',
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 3, name: 'Portal', status: null, progress: 0, task_count: 0, closed_task_count: 0,
    active: true, can_manage: true, allowed_actions: ['read', 'write', 'archive'], stages: [], charter_state: 'draft', phase: 'initiating',
    description_html: '', manager: null, privacy_visibility: 'employees',
    date_start: '2030-01-01', date_end: null, tags: [], followers_count: 0, milestone_count: 0,
    allow_task_dependencies: false, completion_approval: 'none', completion_approver: null,
    objectives:[],success_criteria:'',tools:{planning:{policy:'optional',enabled:true,can_toggle:true},governance:{policy:'optional',enabled:true,can_toggle:true},finance:{policy:'optional',enabled:true,can_toggle:true}},can_read_finance:true,
    updated_at: 'v4', charter: EMPTY_CHARTER, phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [] }, change_control_mode: 'optional', ...overrides,
  }
}

describe('charter conflict resolution', () => {
  it('refuses to overwrite until the newer version has actually been fetched', () => {
    // A 409 means someone else saved. Overwriting on the write token the form
    // already held would discard their edit without anyone seeing it.
    expect(canOverwriteWithLatest('v4', null)).toBe(false)
    expect(canOverwriteWithLatest('v4', project({ updated_at: 'v7' }))).toBe(true)
  })

  it('keeps the visitor draft distinguishable from the record it started as', () => {
    const original = project()
    const draft = draftFromProject(original)
    expect(isCharterDraftDirty(draft, draftFromProject(original))).toBe(false)
    draft.rationale = 'kept'
    expect(isCharterDraftDirty(draft, draftFromProject(original))).toBe(true)
  })

  it('omits an untouched native date from the patch instead of rewriting it', () => {
    const original = project()
    const draft = draftFromProject(original)
    expect(charterPatchBody(draft, 'v4', nativeDateSnapshot(original))).not.toHaveProperty('date_start')
  })
})

describe('charter field surface', () => {
  it('names every commercial field exactly once', () => {
    expect(CHARTER_FIELD_KEYS).toHaveLength(24)
    expect(new Set(CHARTER_FIELD_KEYS).size).toBe(CHARTER_FIELD_KEYS.length)
  })

  it('sends neither budget_state nor amount when the budget is not writable, and both otherwise', () => {
    const draft = draftFromProject(project())
    draft.budgetState = 'estimate'
    draft.amountInput = '500'
    const dates = nativeDateSnapshot(project())
    expect(charterPatchBody(draft, 'v4', dates, false).charter).not.toHaveProperty('budget_state')
    expect(charterPatchBody(draft, 'v4', dates, false).charter).not.toHaveProperty('amount')
    expect(charterPatchBody(draft, 'v4', dates).charter).toMatchObject({ budget_state: 'estimate', amount: 500 })
  })
})
