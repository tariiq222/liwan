import { describe, expect, it } from 'vitest'
import type { ProjectDetail } from '@nasq/contracts'
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
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown' as const, amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft' as const,
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 3, name: 'Portal', status: null, progress: 0, task_count: 0, closed_task_count: 0,
    active: true, can_manage: true, allowed_actions: ['read', 'write', 'archive'], stages: [],
    description_html: '', manager: null, privacy_visibility: 'employees',
    date_start: '2030-01-01', date_end: null, tags: [], followers_count: 0, milestone_count: 0,
    allow_task_dependencies: false, completion_approval: 'none', completion_approver: null,
    updated_at: 'v4', charter: EMPTY_CHARTER, ...overrides,
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
    expect(CHARTER_FIELD_KEYS).toHaveLength(26)
    expect(new Set(CHARTER_FIELD_KEYS).size).toBe(CHARTER_FIELD_KEYS.length)
  })
})
