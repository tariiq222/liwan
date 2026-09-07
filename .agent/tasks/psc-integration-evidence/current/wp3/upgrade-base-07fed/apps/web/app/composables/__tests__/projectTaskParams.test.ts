import { describe, expect, it } from 'vitest'
import { projectTaskParams, projectTaskQuery } from '../projectTaskParams'

describe('projectTaskParams', () => {
  it('defaults to every open task of the project', () => {
    expect(projectTaskParams(3, {})).toEqual({ mine: false, project_id: 3, closed: false, state: undefined, q: undefined })
  })
  it('reads closed, state and q from the query', () => {
    expect(projectTaskParams(3, { closed: '1', state: 'waiting,done', q: 'x', tab: 'board' })).toEqual({
      mine: false, project_id: 3, closed: true, state: ['waiting', 'done'], q: 'x',
    })
  })
  it('round-trips through projectTaskQuery without mine/project_id', () => {
    const params = projectTaskParams(3, { closed: '1', state: 'waiting', q: 'x' })
    expect(projectTaskQuery(params)).toEqual({ closed: '1', state: 'waiting', q: 'x' })
    expect(projectTaskQuery(projectTaskParams(3, {}))).toEqual({ closed: undefined, state: undefined, q: undefined })
  })
})
