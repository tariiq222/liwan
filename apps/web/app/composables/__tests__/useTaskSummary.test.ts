import { describe, expect, it } from 'vitest'
import { summaryQuery, taskKeys } from '../useTasks'

describe('the task summary query', () => {
  it('uses the list filters but not the scope tab, sorting or paging', () => {
    const params = { closed: true, state: ['waiting' as const, 'done' as const], project_id: 4, q: 'x', sort: 'name asc' }
    expect(summaryQuery(params)).toEqual({ filter: 'mine', state: 'waiting,done', project_id: 4, q: 'x' })
    expect(taskKeys.summary(params)).toEqual(taskKeys.summary({ ...params, closed: false, sort: undefined }))
  })

  it('counts a whole project, not only my tasks, when mine is false', () => {
    expect(summaryQuery({ closed: false, mine: false, project_id: 4 }).filter).toBeUndefined()
  })
})
