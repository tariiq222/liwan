import { describe, expect, it } from 'vitest'
import { projectTaskParams, projectTaskQuery } from '../projectTaskParams'
import { normalizeTaskSort, taskSortFromParam, taskSortToParam } from '../taskSort'

describe('task sort param', () => {
  it('round-trips the sortable keys', () => {
    expect(taskSortFromParam('date_deadline desc')).toEqual({ column: 'date_deadline', direction: 'desc' })
    expect(taskSortToParam({ column: 'id', direction: 'asc' })).toBe('id asc')
    expect(taskSortToParam(null)).toBeUndefined()
  })

  it('drops anything else', () => {
    for (const bad of [undefined, '', 'name asc', 'state desc', 'id', 'id up', 'id asc, name asc', ['id asc']]) expect(normalizeTaskSort(bad)).toBeUndefined()
  })

  it('travels through the project screen query and back', () => {
    expect(projectTaskParams(3, { sort: 'priority desc' }).sort).toBe('priority desc')
    expect(projectTaskParams(3, { sort: 'bogus' }).sort).toBeUndefined()
    expect(projectTaskQuery({ closed: false, sort: 'priority desc' }).sort).toBe('priority desc')
    expect(projectTaskQuery({ closed: false }).sort).toBeUndefined()
  })
})
