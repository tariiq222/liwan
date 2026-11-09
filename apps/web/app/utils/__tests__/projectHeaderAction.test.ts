import { describe, expect, it } from 'vitest'
import { projectActionPage } from '../projectHeaderAction'

describe('projectActionPage', () => {
  it('names the three pages whose action the header draws', () => {
    expect(projectActionPage('/projects/7')).toBe('summary')
    expect(projectActionPage('/projects/7/')).toBe('summary')
    expect(projectActionPage('/projects/7/tasks?view=board')).toBe('tasks')
    expect(projectActionPage('/projects/7/meetings')).toBe('meetings')
  })
  it('leaves records, forms and the other sections to their own pages', () => {
    for (const path of ['/projects/7/tasks/3', '/projects/7/tasks/new', '/projects/7/updates/new', '/projects/7/milestones', '/projects/7/finance', '/projects/7/charter', '/projects/7/settings', '/projects', '/projects/new', '/tasks'])
      expect(projectActionPage(path), path).toBeNull()
  })
})
