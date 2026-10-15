import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { firstAllowedPath, requiredCapabilityForPath } from '../../../utils/accessPolicy'

describe('pmo manifest next to the tasks application', () => {
  it('keeps /tasks in the sidebar navigation and the landing paths (projects keep their tasks entry)', () => {
    expect(manifest.nav?.find(n => n.to === '/tasks')).toMatchObject({ labelKey: 'nav.tasks', capability: 'pmo.tasks.read', module: 'projects' })
    expect(manifest.landing?.find(l => l.path === '/tasks')).toEqual({ path: '/tasks', capability: 'pmo.tasks.read' })
  })

  it('owns the /tasks route prefix and its context link', () => {
    expect(manifest.routePrefixes).toContain('/tasks')
    expect(manifest.contextLinks?.('/projects').map(l => l.to)).toContain('/tasks')
  })

  it.each([
    ['/tasks', 'pmo.tasks.read'],
    ['/tasks/4', 'pmo.tasks.read'],
    ['/tasks/new', 'pmo.tasks.create'],
  ])('still requires the PMO capability for %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })

  it('has a deterministic landing for a user holding both task capabilities', () => {
    // Landings are walked in manifest order (pmo before tasks), not rail order, so the first reachable one wins.
    expect(firstAllowedPath({ capabilities: ['tasks.tasks.read', 'pmo.tasks.read'] })).toBe('/tasks')
    expect(firstAllowedPath({ capabilities: ['tasks.tasks.read'] })).toBe('/my-tasks')
    // A PMO reader with projects keeps the project dashboard whatever else they hold.
    expect(firstAllowedPath({ capabilities: ['tasks.tasks.read', 'pmo.tasks.read', 'pmo.projects.read'] })).toBe('/projects/dashboard')
  })
})
