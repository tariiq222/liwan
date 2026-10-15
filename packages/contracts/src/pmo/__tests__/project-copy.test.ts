import { describe, expect, it } from 'vitest'
import { ProjectCopyInputSchema } from '../project'

describe('project copy contract', () => {
  it('trims the name and accepts a calendar start date', () => {
    expect(ProjectCopyInputSchema.parse({ name: '  Launch (copy)  ', start_date: '2030-02-01' })).toEqual({ name: 'Launch (copy)', start_date: '2030-02-01' })
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
