import { describe, expect, it } from 'vitest'
import { projectListReturnTo } from '../projectNavigation'

describe('project list origin', () => {
  it('recovers a filtered list through nested detail and edit routes', () => {
    expect(projectListReturnTo({ returnTo: '/projects/12/settings?returnTo=%2Fprojects%3Fmine%3D1%26q%3Dsite' })).toBe('/projects?mine=1&q=site')
    expect(projectListReturnTo({ projectListReturnTo: '/projects?mine=1', returnTo: '/projects/12' })).toBe('/projects?mine=1')
  })
  it('rejects external, unrelated, and project-detail destinations as list origins', () => {
    for (const returnTo of ['//evil.test/projects', '/projects/12', '/settings/apps/projects', '/projects-other', '/projects/12?returnTo=https%3A%2F%2Fevil.test']) {
      expect(projectListReturnTo({ returnTo })).toBe('/projects')
    }
  })
})

it('rejects a current-project self origin and removes it from a copied parent chain', async () => {
  const { projectRecordBack } = await import('../projectNavigation')
  const paths = ['/projects', '/projects/2', '/projects/2/tasks']
  expect(projectRecordBack({ returnTo: '/projects/2' }, 2, paths)).toEqual({ path: '/projects', query: {} })
  expect(projectRecordBack({ returnTo: '/projects/1?returnTo=%2Fprojects%2F2' }, 2, paths)).toBe('/projects/1')
})
