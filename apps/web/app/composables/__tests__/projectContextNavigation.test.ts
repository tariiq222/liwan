import { describe, it, expect } from 'vitest'
import { isContextPathActive } from '../useShellNavigation'
import { projectIdFromPath } from '../nav/activeRoute'

describe('project list context selection', () => {
  it('keeps all projects active for the list regardless of the mine toggle, its create form and every record', () => {
    expect(isContextPathActive('/projects', '/projects')).toBe(true)
    expect(isContextPathActive('/projects/new', '/projects')).toBe(true)
    expect(isContextPathActive('/projects/42', '/projects')).toBe(true)
    expect(isContextPathActive('/projects/42/stakeholders/3/edit', '/projects')).toBe(true)
    expect(isContextPathActive('/projects/42', '/projects/dashboard')).toBe(false)
    expect(isContextPathActive('/project-templates/3', '/project-templates')).toBe(true)
    expect(isContextPathActive('/project-templates', '/projects')).toBe(false)
  })
  it('keeps my tasks active for task records and the archive', () => {
    expect(isContextPathActive('/tasks/new', '/tasks')).toBe(true)
    expect(isContextPathActive('/tasks/7', '/tasks')).toBe(true)
    expect(isContextPathActive('/archived-tasks', '/tasks')).toBe(true)
    expect(isContextPathActive('/projects/1', '/tasks')).toBe(false)
  })
  it('does not mark a module list active on its create form or on the dashboard', () => {
    expect(isContextPathActive('/chat/new', '/chat')).toBe(false)
    expect(isContextPathActive('/meetings/new', '/meetings')).toBe(false)
    expect(isContextPathActive('/hr/employees/new', '/hr')).toBe(false)
    expect(isContextPathActive('/hr/departments/new', '/hr/departments')).toBe(false)
    expect(isContextPathActive('/hr/documents/new', '/hr/documents')).toBe(false)
    expect(isContextPathActive('/projects/dashboard', '/projects')).toBe(false)
    expect(projectIdFromPath('/projects/dashboard')).toBeNull()
    expect(projectIdFromPath('/projects/new')).toBeNull()
    expect(projectIdFromPath('/projects/42')).toBe(42)
  })
  it('keeps the meetings list inactive on series routes', () => {
    expect(isContextPathActive('/meetings/series', '/meetings')).toBe(false)
    expect(isContextPathActive('/meetings/series/51', '/meetings')).toBe(false)
    expect(isContextPathActive('/meetings/series/51', '/meetings/series')).toBe(true)
    expect(isContextPathActive('/meetings/561', '/meetings')).toBe(true)
  })

})
