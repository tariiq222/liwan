import { describe, expect, it } from 'vitest'
import { ProjectCopyInputSchema, ProjectPatchSchema, ProjectPhaseMoveSchema } from '../project'

describe('project copy contract', () => {
  it('trims the name and accepts a calendar start date', () => {
    expect(ProjectCopyInputSchema.parse({ name: '  Launch (copy)  ', start_date: '2030-02-01' })).toEqual({ name: 'Launch (copy)', start_date: '2030-02-01' })
  })

  it('accepts an optional end date and refuses a malformed one', () => {
    expect(ProjectCopyInputSchema.parse({ name: 'New', start_date: '2030-02-01', end_date: '2030-06-01' }).end_date).toBe('2030-06-01')
    expect(ProjectCopyInputSchema.safeParse({ name: 'New', start_date: '2030-02-01', end_date: '2030-6-1' }).success).toBe(false)
  })

  it('patches the end date as date_end, never together with date', () => {
    expect(ProjectPatchSchema.safeParse({ date_end: '2030-06-01' }).success).toBe(true)
    expect(ProjectPatchSchema.safeParse({ date: '2030-06-01', date_end: '2030-06-01' }).success).toBe(false)
  })

  it('lets a phase move acknowledge warnings', () => {
    expect(ProjectPhaseMoveSchema.safeParse({ phase: 'closed', expected_updated_at: 'v3', acknowledge_warnings: true }).success).toBe(true)
  })

  it('rejects an empty or oversized name', () => {
    expect(ProjectCopyInputSchema.safeParse({ name: '   ', start_date: '2030-02-01' }).success).toBe(false)
    expect(ProjectCopyInputSchema.safeParse({ name: 'x'.repeat(256), start_date: '2030-02-01' }).success).toBe(false)
    expect(ProjectCopyInputSchema.safeParse({ name: 'x'.repeat(255), start_date: '2030-02-01' }).success).toBe(true)
  })

  it('bounds the start date to a real ISO day', () => {
    for (const start_date of ['2030-2-1', '2030-02-31', '', null, undefined]) {
      expect(ProjectCopyInputSchema.safeParse({ name: 'New', start_date }).success).toBe(false)
    }
  })

  it('rejects client-owned fields', () => {
    expect(ProjectCopyInputSchema.safeParse({ name: 'New', start_date: '2030-02-01', user_id: 3 }).success).toBe(false)
  })
})
