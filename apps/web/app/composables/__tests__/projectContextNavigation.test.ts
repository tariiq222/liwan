import { describe, it, expect } from 'vitest'
import { isContextPathActive, projectIdFromPath } from '../useShellNavigation'

describe('project list context selection', () => {
  it('marks only mine or all for the same list path', () => {
    const mine = { path: '/projects', query: { mine: '1' } }
    expect(isContextPathActive('/projects', mine, { mine: '1', q: 'site' })).toBe(true)
    expect(isContextPathActive('/projects', '/projects', { mine: '1' })).toBe(false)
    expect(isContextPathActive('/projects', mine, {})).toBe(false)
    expect(isContextPathActive('/projects', '/projects', {})).toBe(true)
  })
  it('does not mark all-projects active on create or dashboard', () => {
    expect(isContextPathActive('/projects/new', '/projects')).toBe(false)
    expect(isContextPathActive('/chat/new', '/chat')).toBe(false)
    expect(isContextPathActive('/projects/dashboard', '/projects')).toBe(false)
    expect(projectIdFromPath('/projects/dashboard')).toBeNull()
    expect(projectIdFromPath('/projects/new')).toBeNull()
    expect(projectIdFromPath('/projects/42')).toBe(42)
  })
})
