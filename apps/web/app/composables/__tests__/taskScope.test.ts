import { describe, expect, it } from 'vitest'
import { projectTaskParams } from '../projectTaskParams'
import { projectTaskScope, projectTaskScopeQuery } from '../taskScope'

describe('project task scope', () => {
  it('reads open, finished and archived from the query, archived first', () => {
    expect(projectTaskScope({})).toBe('open')
    expect(projectTaskScope({ closed: '1' })).toBe('closed')
    expect(projectTaskScope({ scope: 'archived' })).toBe('archived')
    expect(projectTaskScope({ scope: 'archived', closed: '1' })).toBe('archived')
    expect(projectTaskScope({ scope: 'other' })).toBe('open')
  })

  it('writes one scope and clears the other keys and the state filter', () => {
    expect(projectTaskScopeQuery('closed')).toEqual({ closed: '1', scope: undefined, state: undefined })
    expect(projectTaskScopeQuery('archived')).toEqual({ closed: undefined, scope: 'archived', state: undefined })
    expect(projectTaskScopeQuery('open')).toEqual({ closed: undefined, scope: undefined, state: undefined })
  })

  it('round-trips through the list params', () => {
    expect(projectTaskParams(3, { ...projectTaskScopeQuery('closed') }).closed).toBe(true)
    expect(projectTaskParams(3, { ...projectTaskScopeQuery('open') }).closed).toBe(false)
  })
})
