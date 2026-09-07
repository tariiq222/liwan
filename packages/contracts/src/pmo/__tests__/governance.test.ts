import { describe, expect, it } from 'vitest'
import { ProjectRegisterSchema, ProjectStakeholderListSchema, ProjectRaciSchema } from '../governance'

describe('governance contracts', () => {
  it('requires strict list envelopes and stakeholder refs', () => {
    const result = ProjectStakeholderListSchema.safeParse({ items: [], total: 0, can_manage: true, extra: true })
    expect(result.success).toBe(false)
  })

  it('accepts a RACI row with a strict role', () => {
    expect(ProjectRaciSchema.safeParse({
      id: 1, task: { id: 2, name: 'Task' }, stakeholder: { id: 3, name: 'Sara' }, role: 'A',
    }).success).toBe(true)
    expect(ProjectRaciSchema.safeParse({
      id: 1, task: { id: 2, name: 'Task' }, stakeholder: { id: 3, name: 'Sara' }, role: 'X',
    }).success).toBe(false)
  })

  it('allows null risk metrics for issues and rejects extra fields', () => {
    const issue = { id: 1, kind: 'issue', title: 'Blocker', description: '', priority: 'high', status: 'open', owner: null, due_date: null, response: '', task: null, probability: null, impact: null, score: null }
    expect(ProjectRegisterSchema.safeParse(issue).success).toBe(true)
    expect(ProjectRegisterSchema.safeParse({ ...issue, metadata: 1 }).success).toBe(false)
  })
})

import { ProjectRegisterWriteSchema } from '../governance'
const issue = { id: 1, kind: 'issue', title: 'Blocker', description: '', priority: 'high', status: 'open', owner: null, due_date: null, response: '', task: null, probability: null, impact: null, score: null }
it('enforces risk metrics, issue nullability and the derived score', () => {
  expect(ProjectRegisterSchema.safeParse({ ...issue, kind: 'risk' }).success).toBe(false)
  expect(ProjectRegisterSchema.safeParse({ ...issue, probability: 3 }).success).toBe(false)
  expect(ProjectRegisterSchema.safeParse({ ...issue, kind: 'risk', probability: 4, impact: 5, score: 1 }).success).toBe(false)
  expect(ProjectRegisterSchema.safeParse({ ...issue, kind: 'risk', probability: 4, impact: 5, score: 20 }).success).toBe(true)
  expect(ProjectRegisterWriteSchema.safeParse({ kind: 'issue', probability: 1 }).success).toBe(false)
  expect(ProjectRegisterWriteSchema.safeParse({ kind: 'risk', title: 'Risk' }).success).toBe(false)
  expect(ProjectRegisterWriteSchema.safeParse({ probability: 3 }).success).toBe(true)
})
it('accepts only real date-only calendar strings in reads and writes', () => {
  for (const due_date of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z', new Date('2026-01-01'), '0000-01-01']) {
    expect(ProjectRegisterSchema.safeParse({ ...issue, due_date }).success).toBe(false)
    expect(ProjectRegisterWriteSchema.safeParse({ due_date }).success).toBe(false)
  }
  for (const due_date of ['2024-02-29', '2026-12-31', null]) expect(ProjectRegisterWriteSchema.safeParse({ due_date }).success).toBe(true)
})
