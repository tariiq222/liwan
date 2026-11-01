import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { requiredCapabilityForPath, canReachPath } from '../../../utils/accessPolicy'

describe('operations navigation boundaries', () => {
  it.each([
    ['/operations', 'operations.requests.read'],
    ['/operations/7', 'operations.requests.read'],
    ['/operations/new', 'operations.requests.create'],
    ['/operations/7/edit', 'operations.requests.create'],
    ['/operations/pending', 'operations.requests.read'],
    ['/operations/monitoring', 'operations.monitoring.read'],
    ['/settings/apps/operations/processes/3/edit', 'operations.processes.manage'],
  ])('requires the owning capability for %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
    expect(canReachPath({ capabilities: ['operations.requests.read'] }, path)).toBe(capability === 'operations.requests.read')
  })
  it('defers navigation decisions for other applications and foundation paths', () => {
    expect(manifest.isNavActive?.('/projects/7', '/projects')).toBeUndefined()
    expect(manifest.isNavActive?.('/settings/team/roles/4', '/settings/team/roles')).toBeUndefined()
    expect(requiredCapabilityForPath('/projects/7')).toBe('pmo.projects.read')
    expect(requiredCapabilityForPath('/settings/team/roles/4')).toBe('access.roles.read')
  })
})
