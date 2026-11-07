import { describe, expect, it } from 'vitest'
import { ProjectCreateSchema, ProjectPatchSchema } from '../project'
import { ProjectCharterWriteSchema } from '../project-charter'

const objectives = [{ goal: 'Ship the portal', metric: 'Completed requests', target: '20 in a month' }, { goal: 'Reduce waiting' }]

describe('core project outcomes', () => {
  it('creates a simple project with structured optional outcomes outside the charter', () => {
    expect(ProjectCreateSchema.parse({ name: 'Portal' })).toEqual({ name: 'Portal' })
    expect(ProjectCreateSchema.parse({ name: 'Portal', objectives, success_criteria: '20 requests in a month' })).toEqual({
      name: 'Portal', objectives, success_criteria: '20 requests in a month',
    })
    expect(ProjectCreateSchema.safeParse({ name: 'Portal', objectives: [{ goal: '   ' }] }).success).toBe(false)
    expect(ProjectCreateSchema.safeParse({ name: 'Portal', objectives: [{ goal: 'Ship', id: 2 }] }).success).toBe(false)
    expect(ProjectCreateSchema.safeParse({ name: 'Portal', objectives: [] }).success).toBe(true)
  })

  it.each([{ objectives }, { objectives: [] }, { success_criteria: '' }])('requires CAS for replacement of core outcomes: %j', payload => {
    expect(ProjectPatchSchema.safeParse(payload).success).toBe(false)
    expect(ProjectPatchSchema.safeParse({ ...payload, expected_updated_at: 'v3' }).success).toBe(true)
    expect(ProjectPatchSchema.safeParse({ ...payload, expected_updated_at: '3' }).success).toBe(false)
  })

  it('rejects charter-owned objectives and success instead of keeping two owners', () => {
    expect(ProjectCharterWriteSchema.safeParse({ objectives }).success).toBe(false)
    expect(ProjectCharterWriteSchema.safeParse({ success: 'Done' }).success).toBe(false)
    expect(ProjectCharterWriteSchema.safeParse({ rationale: 'Needed', scope: 'Portal' }).success).toBe(true)
  })
})
