import { describe, expect, it } from 'vitest'
import { projectTaskParams, projectTaskQuery } from '../projectTaskParams'

describe('projectTaskParams', () => {
  it('defaults to every open task of the project', () => {
    expect(projectTaskParams(3, {})).toEqual({ mine: false, project_id: 3, closed: false, state: undefined, q: undefined })
  })
  it('reads closed, state and q from the query, dropping states the scope cannot hold', () => {
    expect(projectTaskParams(3, { closed: '1', state: 'waiting,done', q: 'x', tab: 'board' })).toEqual({
      mine: false, project_id: 3, closed: true, state: ['done'], q: 'x',
    })
    expect(projectTaskParams(3, { state: 'waiting,done' }).state).toEqual(['waiting'])
  })
  it('never passes an unknown state to the API', () => {
    expect(projectTaskParams(3, { state: 'bogus' }).state).toBeUndefined()
    expect(projectTaskParams(3, { closed: '1', state: 'waiting' }).state).toBeUndefined()
  })
  it('round-trips through projectTaskQuery without mine/project_id', () => {
    const params = projectTaskParams(3, { closed: '1', state: 'done', q: 'x' })
    expect(projectTaskQuery(params)).toEqual({ closed: '1', state: 'done', q: 'x' })
    expect(projectTaskQuery(projectTaskParams(3, {}))).toEqual({ closed: undefined, state: undefined, q: undefined })
  })
})
