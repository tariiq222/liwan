import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it } from 'vitest'
import { invalidateProjectCaches, projectKeys } from '../projectKeys'
import { scheduleKeys } from '../useProjectSchedule'
import { governanceKeys } from '../projectGovernanceKeys'

// Every cache entry a project screen reads. A task write changes project
// progress, milestones and stage counts, so all of these must refresh from a
// single root — a second root silently leaves the project workspace stale.
function projectViews(id: number) {
  return [
    projectKeys.list,
    projectKeys.minimal,
    projectKeys.detail(id),
    projectKeys.stages(id),
    projectKeys.followers(id),
    projectKeys.milestones(id),
    projectKeys.updates(id),
    scheduleKeys.detail(id),
    governanceKeys.raci(id),
    governanceKeys.register(id, { offset: 0 }),
  ] as const
}

function seeded(id: number) {
  const qc = new QueryClient()
  for (const key of projectViews(id)) qc.setQueryData(key, 'seed')
  return qc
}

describe('project cache key namespace', () => {
  it('reaches project detail and every sub-resource from the projects root', () => {
    const qc = seeded(7)

    qc.invalidateQueries({ queryKey: projectKeys.all })

    for (const key of projectViews(7)) {
      expect(qc.getQueryState(key)?.isInvalidated, `${JSON.stringify(key)} must be invalidated`).toBe(true)
    }
    qc.clear()
  })

  it('keeps one project scoped to its own id', () => {
    const qc = seeded(7)
    for (const key of projectViews(9)) qc.setQueryData(key, 'seed')

    qc.invalidateQueries({ queryKey: projectKeys.detail(7) })

    expect(qc.getQueryState(projectKeys.milestones(7))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(projectKeys.detail(9))?.isInvalidated).toBeFalsy()
    expect(qc.getQueryState(projectKeys.milestones(9))?.isInvalidated).toBeFalsy()
    qc.clear()
  })
})

describe('invalidateProjectCaches', () => {
  it('refreshes the project list and the open project workspace together', () => {
    const qc = seeded(7)

    invalidateProjectCaches(qc)

    for (const key of projectViews(7)) {
      expect(qc.getQueryState(key)?.isInvalidated, `${JSON.stringify(key)} must be invalidated`).toBe(true)
    }
    qc.clear()
  })
})
