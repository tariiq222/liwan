import { describe, it, expect } from 'vitest'
import { activeShellModule, contextModuleFor } from '../activeRoute'

describe('shell route classification', () => {
  it('keeps the primary module active for direct and nested routes', () => {
    expect(activeShellModule('/projects/12/tasks/44')).toBe('projects')
    expect(activeShellModule('/tasks')).toBe('projects')
    expect(activeShellModule('/tasks/44')).toBe('projects')
    expect(activeShellModule('/projects/dashboard')).toBe('projects')
    expect(activeShellModule('/projects')).toBe('projects')
    expect(activeShellModule('/projects/new')).toBe('projects')
    expect(activeShellModule('/account')).toBeNull()
    expect(contextModuleFor('home')).toBeNull()
    expect(contextModuleFor('meetings')).toBe('meetings')
    expect(activeShellModule('/meetings/calendar')).toBe('meetings')
    expect(activeShellModule('/settings/team/users/18/access')).toBe('settings')
    expect(activeShellModule('/search')).toBeNull()
    expect(activeShellModule('/notifications')).toBeNull()
    expect(activeShellModule('/notification-digests')).toBeNull()
    expect(activeShellModule('/notification-digests/12')).toBeNull()
  })

  it('lights the launcher on /apps and its start pages, and today on the root, with no context sidebar for either', () => {
    expect(activeShellModule('/apps')).toBe('apps')
    expect(activeShellModule('/apps/finance')).toBe('apps')
    expect(activeShellModule('/')).toBe('home')
    expect(activeShellModule('/services')).toBe('home')
    expect(activeShellModule('/Apps')).toBe('apps')
    expect(activeShellModule('/apps/')).toBe('apps')
    expect(activeShellModule('/apps?q=a')).toBe('apps')
    expect(activeShellModule('/Services?x=1')).toBe('home')
    expect(activeShellModule('/applications')).toBeNull()
    expect(contextModuleFor('apps')).toBeNull()
  })
})
