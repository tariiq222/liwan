import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('pmo manifest after the tasks split', () => {
  it('no longer lists /tasks in the sidebar navigation or the landing paths', () => {
    expect(manifest.nav?.map(n => n.to)).not.toContain('/tasks')
    expect(manifest.landing?.map(l => l.path)).not.toContain('/tasks')
  })

  it('still owns the /tasks route prefix and its context link', () => {
    expect(manifest.routePrefixes).toContain('/tasks')
    expect(manifest.contextLinks?.('/projects').map(l => l.to)).toContain('/tasks')
  })
})
