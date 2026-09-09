import { describe, expect, it } from 'vitest'
import {
  deriveProjectOverlayBackground,
  isProjectOverlayRoute,
  wantsProjectOverlayFullPage,
} from '../projectOverlayRoute'

describe('project overlay route contract', () => {
  it('recognises project workflow records while leaving workspace tabs as ordinary routes', () => {
    expect(isProjectOverlayRoute({ path: '/projects/new', query: {} })).toBe(true)
    expect(isProjectOverlayRoute({ path: '/projects/42/tasks/new', query: {} })).toBe(true)
    expect(isProjectOverlayRoute({ path: '/projects/42/tasks/7', query: {} })).toBe(true)
    expect(isProjectOverlayRoute({ path: '/projects/42/finance/9/edit', query: {} })).toBe(true)
    expect(isProjectOverlayRoute({ path: '/projects/42/settings', query: {} })).toBe(true)
    expect(isProjectOverlayRoute({ path: '/projects/42/finance', query: {} })).toBe(false)
    expect(isProjectOverlayRoute({ path: '/projects/42', query: { tab: 'tasks' } })).toBe(false)
    expect(isProjectOverlayRoute({ path: '/projects/42/charter', query: { edit: '1' } })).toBe(true)
  })

  it('accepts an explicit full-page query only for the current workflow route', () => {
    expect(wantsProjectOverlayFullPage({ fullPage: '1' })).toBe(true)
    expect(wantsProjectOverlayFullPage({ fullPage: ['1'] })).toBe(true)
    expect(wantsProjectOverlayFullPage({ fullPage: '0' })).toBe(false)
    expect(wantsProjectOverlayFullPage({})).toBe(false)
  })

  it('preserves a valid project context and rejects foreign or nested workflow returns', () => {
    expect(deriveProjectOverlayBackground('/projects/42/tasks/7', {
      returnTo: '/projects?mine=1&status=active',
    })).toBe('/projects?mine=1&status=active')
    expect(deriveProjectOverlayBackground('/projects/42/tasks/new', {
      returnTo: '/projects/42?tab=tasks&view=board',
    })).toBe('/projects/42?tab=tasks&view=board')
    expect(deriveProjectOverlayBackground('/projects/42/tasks/7', {
      returnTo: 'https://evil.example/steal',
    })).toBe('/projects/42?tab=tasks')
    expect(deriveProjectOverlayBackground('/projects/42/tasks/7', {
      returnTo: '/settings/users',
    })).toBe('/projects/42?tab=tasks')
    expect(deriveProjectOverlayBackground('/projects/42/tasks/7', {
      returnTo: '/projects/42/tasks/new',
    })).toBe('/projects/42?tab=tasks')
    expect(deriveProjectOverlayBackground('/projects/42/tasks/7', {
      returnTo: '/projects/99?tab=tasks',
    })).toBe('/projects/42?tab=tasks')
  })

  it('derives useful parent tabs for direct refreshes without returnTo', () => {
    expect(deriveProjectOverlayBackground('/projects/42/finance/9/edit', {})).toBe('/projects/42/finance')
    expect(deriveProjectOverlayBackground('/projects/42/register/11', {})).toBe('/projects/42/register')
    expect(deriveProjectOverlayBackground('/projects/42/stakeholders/new', {})).toBe('/projects/42/stakeholders')
    expect(deriveProjectOverlayBackground('/projects/42/schedule/tasks/11', {})).toBe('/projects/42/schedule')
    expect(deriveProjectOverlayBackground('/project-templates/3/edit', {})).toBe('/project-templates')
    expect(deriveProjectOverlayBackground('/projects/new', {})).toBe('/projects')
  })
})
