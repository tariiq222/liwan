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
    expect(activeShellModule('/settings/users/18/access')).toBe('settings')
    expect(activeShellModule('/search')).toBeNull()
    expect(activeShellModule('/notifications')).toBeNull()
    expect(activeShellModule('/notification-digests')).toBeNull()
    expect(activeShellModule('/notification-digests/12')).toBeNull()
  })
})
