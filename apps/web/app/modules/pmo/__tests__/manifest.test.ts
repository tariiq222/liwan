import { describe, expect, it } from 'vitest'
import manifest from '../manifest'
import { requiredCapabilityForPath } from '../../../utils/accessPolicy'

describe('pmo manifest after the tasks split', () => {
  it('no longer lists /tasks in the sidebar navigation or the landing paths', () => {
    expect(manifest.nav?.map(n => n.to)).not.toContain('/tasks')
    expect(manifest.landing?.map(l => l.path)).not.toContain('/tasks')
  })

  it('still owns the /tasks route prefix and its context link', () => {
    expect(manifest.routePrefixes).toContain('/tasks')
    expect(manifest.contextLinks?.('/projects').map(l => l.to)).toContain('/tasks')
  })

  it.each([
    ['/tasks', 'pmo.tasks.read'],
    ['/tasks/4', 'pmo.tasks.read'],
    ['/tasks/new', 'pmo.tasks.create'],
    ['/archived-tasks', 'pmo.tasks.read'],
  ])('still requires the PMO capability for %s', (path, capability) => {
    expect(requiredCapabilityForPath(path)).toBe(capability)
  })
})
