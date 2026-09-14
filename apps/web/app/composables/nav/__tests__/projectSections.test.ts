import { describe, it, expect } from 'vitest'
import { PROJECT_SECTION_IDS, projectSections } from '../projectSections'

const reader = { role: 'employee', capabilities: ['pmo.projects.read', 'pmo.tasks.read'] }
const projectOnly = { role: 'employee', capabilities: ['pmo.projects.read'] }
const opts = { active: true }

describe('projectSections', () => {
  it('declares the seven sections in reading order', () => {
    expect(PROJECT_SECTION_IDS).toEqual(['summary', 'tasks', 'schedule', 'milestones', 'governance', 'finance', 'updates'])
  })

  it('maps every section to its own path', () => {
    expect(projectSections(7, reader, opts).map(s => s.to)).toEqual([
      '/projects/7',
      '/projects/7/tasks',
      '/projects/7/schedule',
      '/projects/7/milestones',
      '/projects/7/charter',
      '/projects/7/finance',
      '/projects/7/updates',
    ])
  })

  it('hides task-backed sections without pmo.tasks.read', () => {
    expect(projectSections(7, projectOnly, opts).map(s => s.id)).toEqual(['summary', 'governance', 'finance', 'updates'])
  })

  it('an archived project keeps only read-only sections', () => {
    expect(projectSections(7, reader, { active: false }).map(s => s.id)).toEqual(['summary', 'schedule', 'finance', 'updates'])
  })

  it('returns nothing before capabilities arrive', () => {
    expect(projectSections(7, undefined, opts)).toEqual([])
  })
})
