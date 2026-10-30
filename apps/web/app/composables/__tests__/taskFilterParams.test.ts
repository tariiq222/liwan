import type { TaskListParams } from '../useTasks'
import { describe, expect, it } from 'vitest'
import { projectTaskParams, projectTaskQuery } from '../projectTaskParams'
import { taskSearchText, parseAssignee, parsePriorities, taskAttributeFilterCount, taskAttributeFilters, taskAttributeQuery, taskListQuery, withTaskAttributeFilters, withTaskListFilters } from '../taskFilterParams'
import { summaryQuery, taskKeys } from '../useTasks'

describe('task attribute filters', () => {
  it('accepts only the documented values', () => {
    expect(taskAttributeFilters({ assignee: 'me', deadline: 'week', priority: '3,1' })).toEqual({ assignee: 'me', deadline: 'week', priority: ['3', '1'] })
    expect(taskAttributeFilters({ assignee: '12', deadline: 'none', priority: '0' })).toEqual({ assignee: 12, deadline: 'none', priority: ['0'] })
    expect(taskAttributeFilters({ assignee: 'x', deadline: 'soon', priority: '9,high' })).toEqual({})
    expect(parseAssignee('0')).toBeUndefined()
    expect(parseAssignee('-2')).toBeUndefined()
    expect(parseAssignee('1.5')).toBeUndefined()
  })

  it('lists priorities once, most urgent first, ignoring unknown entries', () => {
    expect(parsePriorities('0,3,3,x')).toEqual(['3', '0'])
    expect(parsePriorities(['1', '2'])).toEqual(['2', '1'])
    expect(parsePriorities('')).toBeUndefined()
  })

  it('lets the URL win over the stored value and falls back when a key is absent', () => {
    const stored = { closed: false, assignee: 'none' as const, priority: ['3' as const] }
    expect(withTaskAttributeFilters(stored, { assignee: 'me' })).toEqual({ closed: false, assignee: 'me', priority: ['3'] })
    expect(withTaskAttributeFilters(stored, { assignee: 'bogus' })).toEqual(stored)
    expect(withTaskAttributeFilters({ closed: true, deadline: 'later' } as never, {})).toEqual({ closed: true })
  })

  it('lets the URL search text win over the stored one and falls back when it is absent', () => {
    expect(withTaskAttributeFilters({ closed: false, q: 'old' } as never, { q: ' لوحة ' })).toEqual({ closed: false, q: 'لوحة' })
    expect(withTaskAttributeFilters({ closed: false, q: 'old' } as never, {})).toEqual({ closed: false, q: 'old' })
    expect(withTaskAttributeFilters({ closed: false } as never, { q: '   ', view: 'board' })).toEqual({ closed: false })
    expect(taskSearchText({ q: ['a', 'b'] })).toBeUndefined()
  })

  it('round-trips through the URL query and counts what is set', () => {
    const filters = { assignee: 7, deadline: 'overdue' as const, priority: ['3' as const, '2' as const] }
    expect(taskAttributeQuery(filters)).toEqual({ assignee: '7', deadline: 'overdue', priority: '3,2' })
    expect(taskAttributeFilters(taskAttributeQuery(filters))).toEqual(filters)
    expect(taskAttributeQuery({})).toEqual({ assignee: undefined, deadline: undefined, priority: undefined })
    expect(taskAttributeFilterCount(filters)).toBe(3)
    expect(taskAttributeFilterCount({})).toBe(0)
  })

  it('travels through the project screen query', () => {
    const params = projectTaskParams(3, { assignee: 'none', deadline: 'today', priority: '3' })
    expect(params).toMatchObject({ mine: false, project_id: 3, assignee: 'none', deadline: 'today', priority: ['3'] })
    expect(projectTaskQuery(params)).toMatchObject({ assignee: 'none', deadline: 'today', priority: '3' })
    expect(projectTaskQuery(projectTaskParams(3, {}))).toMatchObject({ assignee: undefined, deadline: undefined, priority: undefined })
  })

  it('reaches the summary query and its cache key, but never the sort', () => {
    const params = { closed: false, assignee: 'me' as const, deadline: 'week' as const, priority: ['3' as const], sort: 'name asc' }
    expect(summaryQuery(params)).toEqual({ filter: undefined, state: undefined, project_id: undefined, q: undefined, assignee: 'me', deadline: 'week', priority: '3' })
    expect(taskKeys.summary(params)).toEqual(taskKeys.summary({ ...params, sort: undefined }))
    expect(taskKeys.summary(params)).not.toEqual(taskKeys.summary({ ...params, deadline: 'today' }))
    expect(summaryQuery({ closed: false, priority: ['3'] }).filter).toBe('mine')
  })
})

describe('withTaskListFilters', () => {
  it('reads the scope from the URL alone', () => {
    expect(withTaskListFilters({ closed: true } as TaskListParams, {}).closed).toBe(false)
    expect(withTaskListFilters({ closed: false } as TaskListParams, { closed: '1' }).closed).toBe(true)
  })

  it('lets the URL win for state and project and falls back to the stored values', () => {
    const stored = { closed: false, state: ['waiting'], project_id: 3 } as TaskListParams
    expect(withTaskListFilters(stored, {})).toMatchObject({ state: ['waiting'], project_id: 3 })
    expect(withTaskListFilters(stored, { state: 'in_progress', project_id: '9' })).toMatchObject({ state: ['in_progress'], project_id: 9 })
    expect(withTaskListFilters(stored, { state: 'bogus', project_id: 'x' })).toMatchObject({ state: ['waiting'], project_id: 3 })
  })

  it('drops a state the scope cannot contain', () => {
    expect(withTaskListFilters({ closed: false, state: ['waiting'] } as TaskListParams, { closed: '1' }).state).toBeUndefined()
    expect(withTaskListFilters({ closed: false, state: ['waiting', 'done'] } as TaskListParams, { closed: '1' }).state).toEqual(['done'])
  })

  it('round-trips through the URL query', () => {
    const params = { closed: true, state: ['done' as const], project_id: 4, q: ' لوحة ', priority: ['3' as const] }
    const query = taskListQuery(params)
    expect(query).toMatchObject({ closed: '1', state: 'done', project_id: '4', q: 'لوحة', priority: '3' })
    expect(withTaskListFilters({ closed: false } as TaskListParams, query)).toMatchObject({ closed: true, state: ['done'], project_id: 4, q: 'لوحة', priority: ['3'] })
  })

  it('removes the keys of an empty list state', () => {
    expect(taskListQuery({ closed: false, state: [] })).toMatchObject({ closed: undefined, state: undefined, project_id: undefined, q: undefined })
  })
})
