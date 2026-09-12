import { describe, it, expect } from 'vitest'
import { activeProjectSection, projectIdFromPath } from '../activeRoute'

describe('projectIdFromPath', () => {
  it('reads a positive integer id', () => {
    expect(projectIdFromPath('/projects/12/tasks')).toBe(12)
  })
  it('rejects non-numeric and non-positive ids', () => {
    expect(projectIdFromPath('/projects/abc')).toBeNull()
    expect(projectIdFromPath('/projects/0')).toBeNull()
    expect(projectIdFromPath('/projects')).toBeNull()
  })
})

describe('activeProjectSection', () => {
  it('maps the project root to the summary', () => {
    expect(activeProjectSection('/projects/12')).toBe('summary')
    expect(activeProjectSection('/projects/12/')).toBe('summary')
  })
  it('maps each section root to itself', () => {
    expect(activeProjectSection('/projects/12/tasks')).toBe('tasks')
    expect(activeProjectSection('/projects/12/schedule')).toBe('schedule')
    expect(activeProjectSection('/projects/12/milestones')).toBe('milestones')
    expect(activeProjectSection('/projects/12/governance')).toBe('governance')
    expect(activeProjectSection('/projects/12/finance')).toBe('finance')
    expect(activeProjectSection('/projects/12/updates')).toBe('updates')
  })
  it('keeps a record page on its owning section', () => {
    expect(activeProjectSection('/projects/12/tasks/99')).toBe('tasks')
    expect(activeProjectSection('/projects/12/finance/5/edit')).toBe('finance')
    expect(activeProjectSection('/projects/12/schedule/tasks/99')).toBe('schedule')
  })
  it('maps the four governance children to governance', () => {
    expect(activeProjectSection('/projects/12/charter')).toBe('governance')
    expect(activeProjectSection('/projects/12/stakeholders')).toBe('governance')
    expect(activeProjectSection('/projects/12/stakeholders/3/edit')).toBe('governance')
    expect(activeProjectSection('/projects/12/raci')).toBe('governance')
    expect(activeProjectSection('/projects/12/register/8')).toBe('governance')
  })
  it('returns null for settings and for paths outside a project', () => {
    expect(activeProjectSection('/projects/12/settings')).toBeNull()
    expect(activeProjectSection('/projects')).toBeNull()
    expect(activeProjectSection('/tasks/99')).toBeNull()
  })
})
