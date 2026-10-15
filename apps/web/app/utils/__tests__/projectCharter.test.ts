import { describe, expect, it } from 'vitest'
import { ApiError } from '../../composables/useApi'
import type { ProjectDetail } from '@nasq/contracts'
import {
  CHARTER_FIELD_KEYS,
  canOverwriteWithLatest,
  charterWriteFromDraft,
  charterCreateBody,
  charterErrorsForFields,
  createdProjectLocation,
  draftFromProject,
  draftedProjectLocation,
  charterAfterSave,
  submitFailureReason,
  sponsorMissingForSubmit,
  emptyCharterDraft,
  hasCharterWriteContent,
  isCharterDraftDirty,
  isIsoDate,
  nativeDateSnapshot,
  parseAmountInput,
  charterPatchBody,
  stripBlankDeliverables,
  stripBlankObjectives,
  validateCharterDraft,
  aggregateMilestoneOutputs,
} from '../projectCharter'

const EMPTY_CHARTER = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown' as const, amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '', state: 'draft' as const,
    approval_required: false, can_review: false, submitted_by: null, submitted_at: null,
    approved_by: null, approved_at: null, return_note: '',
}

function project(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 3,
    name: 'Portal',
    status: null,
    progress: 0,
    task_count: 0,
    closed_task_count: 0,
    active: true,
    can_manage: true,
    allowed_actions: ['read', 'write', 'archive'],
    charter_state: 'draft',
    phase: 'initiating',
    phase_state: { current: 'initiating', next: 'planning', previous: null, next_checks: [], can_move: true },
    stages: [],
    description_html: '<p>desc</p>',
    manager: { id: 2, name: 'Sara' },
    privacy_visibility: 'employees',
    date_start: '2030-01-01',
    date_end: null,
    tags: [],
    followers_count: 0,
    milestone_count: 0,
    allow_task_dependencies: false,
    completion_approval: 'none',
    completion_approver: null,
    updated_at: 'v4',
    charter: EMPTY_CHARTER,
    ...overrides,
  }
}

describe('CHARTER_FIELD_KEYS', () => {
  it('names all 26 commercial fields including requirements, benefits, success and acceptance', () => {
    expect(CHARTER_FIELD_KEYS).toHaveLength(26)
    expect(CHARTER_FIELD_KEYS).toEqual(expect.arrayContaining([
      'name', 'code', 'description', 'type', 'owning_unit', 'sponsor', 'manager',
      'authority', 'rationale', 'objectives', 'benefits', 'scope', 'exclusions',
      'high_level_requirements', 'deliverables', 'acceptance', 'success',
      'date_start', 'date_end', 'budget_state', 'amount', 'currency', 'priority',
      'assumptions', 'constraints', 'closure',
    ]))
  })
})

describe('parseAmountInput', () => {
  it('treats blank as null, zero as a valid estimate, and rejects non-finite or negative values', () => {
    expect(parseAmountInput('')).toEqual({ ok: true, value: null })
    expect(parseAmountInput(' 0 ')).toEqual({ ok: true, value: 0 })
    expect(parseAmountInput('12.50')).toEqual({ ok: true, value: 12.5 })
    expect(parseAmountInput('-1')).toEqual({ ok: false, code: 'invalid' })
    expect(parseAmountInput('Infinity')).toEqual({ ok: false, code: 'invalid' })
    expect(parseAmountInput('1e2')).toEqual({ ok: false, code: 'invalid' })
    expect(parseAmountInput('true')).toEqual({ ok: false, code: 'invalid' })
  })
})

describe('isIsoDate', () => {
  it('accepts exact YYYY-MM-DD calendar dates and empty, without timezone parsing', () => {
    expect(isIsoDate(null)).toBe(true)
    expect(isIsoDate('2030-02-01')).toBe(true)
    expect(isIsoDate('2030-02-30')).toBe(false)
    expect(isIsoDate('2030-02-01T00:00:00Z')).toBe(false)
  })
})

describe('row stripping', () => {
  it('keeps partial rows and drops only fully blank ones', () => {
    const draft = emptyCharterDraft()
    draft.objectives = [
      { key: '1', goal: 'Ship', metric: '', target: '', persisted: false },
      { key: '2', goal: '  ', metric: '', target: '', persisted: false },
    ]
    draft.deliverables = [
      { key: '3', name: '', description: '', acceptance: 'Signed', persisted: false },
      { key: '4', name: '', description: '  ', acceptance: '', persisted: false },
    ]
    expect(stripBlankObjectives(draft.objectives)).toEqual([
      { key: '1', goal: 'Ship', metric: '', target: '', persisted: false },
    ])
    expect(stripBlankDeliverables(draft.deliverables)).toEqual([
      { key: '3', name: '', description: '', acceptance: 'Signed', persisted: false },
    ])
  })
})

describe('charterCreateBody', () => {
  it('allows a name-only create and omits empty charter, code, and currency', () => {
    const draft = emptyCharterDraft('SAR (ر.س)')
    draft.name = '  New portal  '
    expect(charterCreateBody(draft)).toEqual({ name: 'New portal' })
  })

  it('can preserve an explicit optional no-manager selection from the create form', () => {
    const draft = emptyCharterDraft()
    draft.name = 'No manager'
    expect(charterCreateBody(draft, { includeNullManager: true }).user_id).toBeNull()
  })

  it('puts native fields outside charter and catalog ids inside charter', () => {
    const draft = emptyCharterDraft()
    draft.name = 'Portal'
    draft.description = 'Summary'
    draft.userId = 9
    draft.dateStart = '2030-01-01'
    draft.dateEnd = '2030-06-01'
    draft.typeId = 4
    draft.sponsorId = 2
    draft.authority = 'Board'
    draft.budgetState = 'estimate'
    draft.amountInput = '0'
    const body = charterCreateBody(draft)
    expect(body).toMatchObject({
      name: 'Portal',
      description: 'Summary',
      user_id: 9,
      date_start: '2030-01-01',
      date: '2030-06-01',
    })
    expect(body.charter).toEqual({
      type_id: 4,
      sponsor_id: 2,
      authority: 'Board',
      budget_state: 'estimate',
      amount: 0,
    })
    expect(body.charter).not.toHaveProperty('code')
    expect(body.charter).not.toHaveProperty('currency')
  })

  it('preserves a supported end-only create date and rejects silent start-only loss', () => {
    const draft = emptyCharterDraft()
    draft.name = 'Portal'
    draft.dateEnd = '2030-06-01'
    expect(charterCreateBody(draft)).toMatchObject({ date_end: '2030-06-01' })
    draft.dateStart = '2030-01-01'
    draft.dateEnd = null
    expect(validateCharterDraft(draft, { mode: 'create' }).some((error) => error.code === 'pair')).toBe(true)
  })
})

describe('charterPatchBody dates', () => {
  it('omits unchanged native dates so a legacy one-sided range is not cleared', () => {
    const original = project()
    const draft = draftFromProject(original)
    draft.rationale = 'Need'
    const patch = charterPatchBody(draft, 'v4', nativeDateSnapshot(original))
    expect(patch.expected_updated_at).toBe('v4')
    expect(patch.charter?.rationale).toBe('Need')
    expect(patch).not.toHaveProperty('date_start')
    expect(patch).not.toHaveProperty('date')
  })

  it('sends a paired write when both dates change together', () => {
    const original = project()
    const draft = draftFromProject(original)
    draft.dateStart = '2030-02-01'
    draft.dateEnd = '2030-06-01'
    const patch = charterPatchBody(draft, 'v4', nativeDateSnapshot(original))
    expect(patch.date_start).toBe('2030-02-01')
    expect(patch.date).toBe('2030-06-01')
  })

  it('sends a paired clear when both dates are emptied', () => {
    const original = project({ date_start: '2030-01-01', date_end: '2030-06-01' })
    const draft = draftFromProject(original)
    draft.dateStart = null
    draft.dateEnd = null
    const patch = charterPatchBody(draft, 'v4', nativeDateSnapshot(original))
    expect(patch.date_start).toBeNull()
    expect(patch.date).toBeNull()
  })

  it('sends only date when changing to a supported end-only range', () => {
    const original = project({ date_start: '2030-01-01', date_end: '2030-06-01' })
    const draft = draftFromProject(original)
    draft.dateStart = null
    const patch = charterPatchBody(draft, 'v4', nativeDateSnapshot(original))
    expect(patch).not.toHaveProperty('date_start')
    expect(patch.date).toBe('2030-06-01')
  })
})

describe('charterPatchBody hidden charter values', () => {
  it('preserves historical values when editing only the project name', () => {
    const original = project({
      charter: {
        ...EMPTY_CHARTER,
        sponsor: { id: 8, name: 'Noura' },
        benefits: 'Faster intake',
        high_level_requirements: 'SSO access',
        deliverables: [{ name: 'Legacy report', description: 'Old output', acceptance: 'Signed off' }],
      },
    })
    const draft = draftFromProject(original)
    draft.name = 'Renamed portal'

    const patch = charterPatchBody(draft, 'v4', nativeDateSnapshot(original))

    expect(patch.name).toBe('Renamed portal')
    expect(patch.charter).toMatchObject({
      sponsor_id: 8,
      benefits: 'Faster intake',
      high_level_requirements: 'SSO access',
      deliverables: [{ name: 'Legacy report', description: 'Old output', acceptance: 'Signed off' }],
    })
  })
})

describe('validateCharterDraft', () => {
  it('rejects unknown budgets with an amount and estimate without a number', () => {
    const draft = emptyCharterDraft()
    draft.name = 'X'
    draft.budgetState = 'unknown'
    draft.amountInput = '10'
    expect(validateCharterDraft(draft).some((error) => error.field === 'amount')).toBe(true)
    draft.budgetState = 'estimate'
    draft.amountInput = ''
    expect(validateCharterDraft(draft).some((error) => error.code === 'estimate_required')).toBe(true)
    draft.amountInput = '0'
    expect(validateCharterDraft(draft)).toEqual([])
  })

  it('accepts end-only dates but rejects start-only writes', () => {
    const created = emptyCharterDraft()
    created.name = 'X'
    created.dateEnd = '2030-06-01'
    expect(validateCharterDraft(created, { mode: 'create' })).toEqual([])
    created.dateStart = '2030-01-01'
    created.dateEnd = null
    expect(validateCharterDraft(created, { mode: 'create' }).some((error) => error.code === 'pair')).toBe(true)
    const original = project()
    const draft = draftFromProject(original)
    expect(validateCharterDraft(draft, { mode: 'edit', originalDates: nativeDateSnapshot(original) })).toEqual([])
    draft.dateEnd = '2030-06-01'
    draft.dateStart = null
    expect(validateCharterDraft(draft, { mode: 'edit', originalDates: nativeDateSnapshot(original) })).toEqual([])
  })
})

describe('stale write review helpers', () => {
  it('keeps the original token until a distinct server version is loaded', () => {
    const original = project({ updated_at: 'v4' })
    const newer = project({ updated_at: 'v5', charter: { ...EMPTY_CHARTER, rationale: 'theirs' } })
    expect(canOverwriteWithLatest('v4', null)).toBe(false)
    expect(canOverwriteWithLatest('v4', original)).toBe(false)
    expect(canOverwriteWithLatest('v4', newer)).toBe(true)
    const draft = draftFromProject(original)
    draft.rationale = 'mine'
    expect(isCharterDraftDirty(draft, draftFromProject(original))).toBe(true)
    expect(draft.rationale).toBe('mine')
    expect(newer.updated_at).toBe('v5')
  })
})

describe('charterWriteFromDraft', () => {
  it('does not treat an empty create write as content', () => {
    expect(hasCharterWriteContent(charterWriteFromDraft(emptyCharterDraft(), 'create'))).toBe(false)
  })
})

describe('charter document helpers', () => {
  it('routes a created project to milestones while carrying the originating list URL', () => {
    expect(createdProjectLocation(42, '/projects?status=active')).toEqual({
      path: '/projects/42',
      query: { returnTo: '/projects?status=active', tab: 'milestones' },
    })
  })

  it('flattens milestone checklist outputs while keeping their milestone identity', () => {
    expect(aggregateMilestoneOutputs([
      { id: 4, name: 'Discovery', deliverables: [{ name: 'Brief', done: true }, { name: '  ', done: false }] },
      { id: 5, name: 'Launch', deliverables: [{ name: 'Runbook', done: false }] },
    ])).toEqual([
      { milestoneId: 4, milestoneName: 'Discovery', name: 'Brief', done: true },
      { milestoneId: 5, milestoneName: 'Launch', name: 'Runbook', done: false },
    ])
  })
})

describe('charter state on the wire', () => {
  it('never writes the charter state', () => {
    const draft = emptyCharterDraft()
    draft.name = 'P'
    draft.charterState = 'approved'
    expect(charterCreateBody(draft)).not.toHaveProperty('state')
    expect(charterPatchBody(draft, 'v3', { dateStart: null, dateEnd: null }).charter).not.toHaveProperty('state')
  })

  it('never sends the state; the server owns it', () => {
    const draft = emptyCharterDraft()
    draft.name = 'Portal'
    expect(charterCreateBody(draft)).not.toHaveProperty('charter')
    draft.charterState = 'approved'
    expect(charterCreateBody(draft)).not.toHaveProperty('charter')
    expect(charterPatchBody(draft, 'v1', { dateStart: null, dateEnd: null }).charter).not.toHaveProperty('state')
  })

  it('loads the charter state and the type steps from the project detail', () => {
    const loaded = draftFromProject(project({
      charter: {
        ...EMPTY_CHARTER,
        state: 'approved',
        type: { id: 4, name: 'تقني', charter_steps: ['justification', 'scope'] },
      },
    }))
    expect(loaded.charterState).toBe('approved')
    expect(loaded.typeSteps).toEqual(['justification', 'scope'])
    expect(draftFromProject(project()).typeSteps).toBeNull()
  })

  it('does not count a state change as an unsaved edit', () => {
    const base = emptyCharterDraft()
    const changed = { ...emptyCharterDraft(), charterState: 'approved' as const }
    expect(isCharterDraftDirty(changed, base)).toBe(false)
  })

  it('filters step errors and routes a drafted project back into its charter step', () => {
    const errors = [{ field: 'name' as const, code: 'required' }, { field: 'amount' as const, code: 'invalid' }]
    expect(charterErrorsForFields(errors, ['name', 'description'])).toEqual([{ field: 'name', code: 'required' }])
    expect(draftedProjectLocation(9, 'scope', '/projects?q=x')).toEqual({
      path: '/projects/9/charter',
      query: { returnTo: '/projects?q=x', edit: '1', step: 'scope' },
    })
  })
})

describe('charter submit decisions', () => {
  it('never resubmits an approved charter the server reopened', () => {
    expect(charterAfterSave(true, 'draft')).toBe('reopened')
    expect(charterAfterSave(true, 'approved')).toBe('saved')
    expect(charterAfterSave(false, 'draft')).toBe('submit')
    expect(charterAfterSave(false, 'submitted')).toBe('saved')
  })

  it('explains why a submit failed', () => {
    const t = (key: string) => key
    expect(submitFailureReason(new ApiError(422, 'invalid', 'Sponsor needed', 'name'), t)).toBe('Sponsor needed')
    expect(submitFailureReason(new ApiError(422, 'invalid', 'Choose a sponsor', 'sponsor_id'), t)).toBe('projects.charter.sponsorRequired')
    expect(submitFailureReason(new ApiError(422, 'invalid', 'Other', 'note'), t)).toBe('Other')
    expect(submitFailureReason(new ApiError(409, 'charter_state', 'x'), t)).toBe('projects.charter.lockedWhileSubmitted')
    expect(submitFailureReason(new Error('boom'), t)).toBe('errors.generic')
  })

  it('blocks a submit without a sponsor only under the approval policy', () => {
    expect(sponsorMissingForSubmit(true, false, null)).toBe(true)
    expect(sponsorMissingForSubmit(true, false, 7)).toBe(false)
    expect(sponsorMissingForSubmit(false, false, null)).toBe(false)
    expect(sponsorMissingForSubmit(true, true, null)).toBe(false)
  })
})
