import { describe, expect, it } from 'vitest'
import { archivedTaskQuery } from '../useArchivedTasks'

describe('archived task query scope', () => {
  it('defaults an unscoped request to the current user archive', () => {
    expect(archivedTaskQuery({}, 0)).toEqual({
      project_id: undefined,
      filter: 'mine',
      q: undefined,
      limit: 50,
      offset: 0,
    })
  })

  it('keeps an explicit project archive scope available to permitted callers', () => {
    expect(archivedTaskQuery({ project_id: 17 }, 50)).toEqual({
      project_id: 17,
      filter: undefined,
      q: undefined,
      limit: 50,
      offset: 50,
    })
  })

  it('preserves an explicit mine filter even with a project scope', () => {
    expect(archivedTaskQuery({ project_id: 17, mine: true, q: '  old  ' }, 0)).toEqual({
      project_id: 17,
      filter: 'mine',
      q: '  old  ',
      limit: 50,
      offset: 0,
    })
  })
})
