import { describe, expect, it } from 'vitest'
import {
  ProjectScheduleSchema, FinanceEntryListSchema, MilestoneSchema, ProjectCharterReferenceListSchema, ProjectRaciListSchema,
  ProjectRegisterListSchema, ProjectStakeholderListSchema, TaskListSchema,
} from '@webvue/contracts'
// the preview module is plain ESM shared with the mock server, so its inferred types are cast loose below
import { pmoPreviewData } from '../../../e2e/pmo-ui-preview-data.mjs'
import { projectsPreviewData } from '../../../e2e/projects-ui-preview-data.mjs'

const CURRENCY = { id: 1, name: 'SAR', symbol: 'ر.س', decimal_places: 2 }
const TASKS = [101, 102, 103, 104].map(id => ({
  id, name: `مهمة ${id}`, description_excerpt: '', subtask_count: 0, subtask_done_count: 0, attachment_count: 0, project: { id: 1, name: 'مشروع ألفا' }, state: 'in_progress', priority: '1', date_deadline: '2035-01-15',
  days_remaining: 120, is_overdue: false, is_closed: false, personal_stage: null, stage: { id: 11, name: 'جديد' },
  assignees: [{ id: 2, name: 'Admin' }], tags: [], can_write: true, can_approve: true, allowed_transitions: ['done'],
}))
const preview = pmoPreviewData as unknown as (path: string, url: URL, ctx: Record<string, unknown>) => any // eslint-disable-line @typescript-eslint/no-explicit-any
const get = (path: string) => {
  const url = new URL(`http://x${path}`)
  return preview(url.pathname, url, { PROJECTS: [], TASKS, CURRENCY })
}

describe('the PMO preview fixtures parse with the wire contracts', () => {
  it.each([
    ['/api/v1/projects/2/milestones', MilestoneSchema.array(), 3],
    ['/api/v1/projects/2/stakeholders', ProjectStakeholderListSchema, 3],
    ['/api/v1/projects/2/register', ProjectRegisterListSchema, 3],
    ['/api/v1/projects/2/raci', ProjectRaciListSchema, 3],
    ['/api/v1/projects/2/finance', FinanceEntryListSchema, 4],
    ['/api/v1/projects/3/milestones', MilestoneSchema.array(), 3],
    ['/api/v1/projects/3/stakeholders', ProjectStakeholderListSchema, 3],
    ['/api/v1/projects/3/register', ProjectRegisterListSchema, 3],
    ['/api/v1/projects/3/raci', ProjectRaciListSchema, 3],
    ['/api/v1/projects/3/finance', FinanceEntryListSchema, 4],
    ['/api/v1/project-charter/catalogs/owning-units?active=all', ProjectCharterReferenceListSchema, 3],
    ['/api/v1/tasks/archived', TaskListSchema, 3],
    ['/api/v1/project-charter/catalogs/types?active=all', ProjectCharterReferenceListSchema, 3],
  ] as const)('%s', (path, schema, count) => {
    const body = get(path)
    const parsed = schema.parse(body)
    expect(Array.isArray(parsed) ? parsed : parsed.items).toHaveLength(count)
  })

  it('project 3 is read-only and project 2 manages', () => {
    expect(get('/api/v1/projects/2/register').can_manage).toBe(true)
    expect(get('/api/v1/projects/3/register').can_manage).toBe(false)
    expect(get('/api/v1/projects/3/finance').can_manage).toBe(false)
    expect(get('/api/v1/projects/3/stakeholders').can_manage).toBe(false)
    expect(get('/api/v1/projects/3/raci').can_manage).toBe(false)
  })

  it('leaves everything else to the pilot module', () => {
    expect(get('/api/v1/projects/1/register')).toBeUndefined()
    expect(get('/api/v1/people')).toBeUndefined()
  })

  it('hides the inactive catalog item unless asked for', () => {
    expect(get('/api/v1/project-charter/catalogs/types').items).toHaveLength(2)
  })
})

describe('schedule fixture capabilities', () => {
  it.each([[2, true], [3, false]] as const)('project %i carries can_manage=%s through its schedule', (projectId, canManage) => {
    const path = `/api/v1/projects/${projectId}/schedule`
    const result = projectsPreviewData(path, new URL(path, 'http://localhost'), {
      PROJECTS: [{ id: 2, can_manage: true }, { id: 3, can_manage: false }], TASKS, CURRENCY,
      projectDetail: () => null, reportRow: (project: unknown) => project,
    })
    expect(ProjectScheduleSchema.parse(result).can_manage).toBe(canManage)
  })
})
