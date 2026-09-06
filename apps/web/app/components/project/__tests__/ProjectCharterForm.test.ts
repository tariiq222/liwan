import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ProjectDetail } from '@nasq/contracts'
import {
  CHARTER_FIELD_KEYS,
  canOverwriteWithLatest,
  draftFromProject,
  isCharterDraftDirty,
  nativeDateSnapshot,
  patchBodyFromDraft,
} from '../../../utils/projectCharter'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function source(name: string): string {
  return readFileSync(resolve(root, name), 'utf8')
}

const EMPTY_CHARTER = {
  code: null, type: null, owning_unit: null, sponsor: null, authority: '', rationale: '',
  objectives: [], benefits: '', scope: '', exclusions: '', high_level_requirements: '',
  deliverables: [], success: '', budget_state: 'unknown' as const, amount: null,
  currency: { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 },
  priority: null, assumptions: '', constraints: '', closure: '',
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

describe('ProjectCharterForm field surface', () => {
  it('renders a named test id for every commercial charter field including requirements, benefits, success and acceptance', () => {
    const fields = source('ProjectCharterFields.vue') + source('ProjectCharterRows.vue')
    for (const key of CHARTER_FIELD_KEYS) {
      expect(fields, `missing charter-field-${key}`).toContain(`data-testid="charter-field-${key}"`)
    }
    expect(CHARTER_FIELD_KEYS).toHaveLength(26)
  })

  it('reviews a 409 against a fetched server version without silently refreshing the write token', () => {
    const form = source('ProjectCharterForm.vue')
    expect(form).toContain('canOverwriteWithLatest')
    expect(form).toContain('overwriteOnLatest')
    expect(form).toContain('serverVersion.value.updated_at')
    expect(form).toContain('projectQuery.refetch')
    expect(form).toContain('isCharterDraftDirty')
    expect(form).not.toContain('retrySave')
    const original = project({ updated_at: 'v4' })
    const server = project({ updated_at: 'v7' })
    const draft = draftFromProject(original)
    draft.rationale = 'kept'
    expect(canOverwriteWithLatest('v4', null)).toBe(false)
    expect(canOverwriteWithLatest('v4', server)).toBe(true)
    expect(isCharterDraftDirty(draft, draftFromProject(original))).toBe(true)
    expect(patchBodyFromDraft(draft, 'v4', nativeDateSnapshot(original))).not.toHaveProperty('date_start')
  })

  it('places help beside fields and child rows without a permanent description paragraph', () => {
    const fields = source('ProjectCharterFields.vue')
    const rows = source('ProjectCharterRows.vue')
    expect(fields).toContain('ProjectFieldHelp')
    expect(rows).toContain('ProjectFieldHelp')
    expect(fields).toContain('projects.charter.help.name')
    expect(rows).toContain('projects.charter.help.acceptance')
    expect(rows).toContain('removeRowConfirm')
    expect(fields).not.toContain('Dialog')
    expect(fields).not.toContain('Sheet')
  })
})
