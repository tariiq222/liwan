import { describe, it, expect } from 'vitest'
import { legacyProjectTabTarget } from '../legacyProjectTab'

describe('legacyProjectTabTarget', () => {
  it('sends tab=tasks to the tasks section', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'tasks' })).toEqual({ path: '/projects/7/tasks', query: {} })
  })
  it('turns tab=board and tab=list into the view parameter', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'board' })).toEqual({ path: '/projects/7/tasks', query: { view: 'board' } })
    expect(legacyProjectTabTarget('/projects/7', { tab: 'list' })).toEqual({ path: '/projects/7/tasks', query: { view: 'list' } })
  })
  it('sends tab=milestones and tab=summary to their sections', () => {
    expect(legacyProjectTabTarget('/projects/7', { tab: 'milestones' })).toEqual({ path: '/projects/7/milestones', query: {} })
    expect(legacyProjectTabTarget('/projects/7', { tab: 'summary' })).toEqual({ path: '/projects/7', query: {} })
  })
  it('treats a bare view=board as the tasks section', () => {
    expect(legacyProjectTabTarget('/projects/7', { view: 'board' })).toEqual({ path: '/projects/7/tasks', query: { view: 'board' } })
  })
  it('carries filters through and drops the dead state keys', () => {
    const target = legacyProjectTabTarget('/projects/7', { tab: 'tasks', q: 'عقد', state: 'in_progress', taskContext: '{"q":"x"}', projectListReturnTo: '/projects', returnTo: '/projects' })
    expect(target).toEqual({ path: '/projects/7/tasks', query: { q: 'عقد', state: 'in_progress' } })
  })
  it('leaves already-migrated and non-project routes alone', () => {
    expect(legacyProjectTabTarget('/projects/7/tasks', { view: 'board' })).toBeNull()
    expect(legacyProjectTabTarget('/projects/7', {})).toBeNull()
    expect(legacyProjectTabTarget('/tasks', { tab: 'tasks' })).toBeNull()
  })
})
