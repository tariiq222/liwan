import { describe, it, expect } from 'vitest'
import { savedProjectLocation, projectEntryLocation } from '../projectWorkspaceMemory'

describe('project workspace memory', () => {
  it('retains both searches and pages of the responsibility matrix', () => {
    const query = { task_q: 'review', stakeholder_q: 'manager', task_page: '2', stakeholder_page: '3' }
    expect(savedProjectLocation('/projects/7/raci', query)?.query).toEqual(query)
  })
  it('keeps section filters while replacing the old list origin', () => {
    const saved = savedProjectLocation('/projects/7/register', { q: 'risk', kind: 'risk', returnTo: '/projects?mine=1' })
    expect(saved).toEqual({ path: '/projects/7/register', query: { q: 'risk', kind: 'risk' } })
    expect(projectEntryLocation(7, '/projects?q=new', saved)).toEqual({ path: '/projects/7/register', query: { q: 'risk', kind: 'risk', returnTo: '/projects?q=new', projectListReturnTo: '/projects?q=new' } })
  })
  it('does not remember forms, settings or individual records', () => {
    for (const path of ['/projects/new', '/projects/7/settings', '/projects/7/tasks/3', '/projects/7/register/new', '/projects/7/finance/2/edit']) expect(savedProjectLocation(path, {})).toBeNull()
    expect(savedProjectLocation('/projects/7/charter', { edit: '1' })).toBeNull()
  })
  it('retains task view context but strips nested workflow state', () => {
    expect(savedProjectLocation('/projects/7', { tab: 'tasks', view: 'board', q: 'alpha', taskContext: '{"q":"x","returnTo":"/evil"}', standalone: '1' })).toEqual({ path: '/projects/7', query: { tab: 'tasks', view: 'board', q: 'alpha', taskContext: '{"q":"x"}' } })
  })
  it('rejects another project and external or malformed saved routes', () => {
    for (const candidate of [{path:'/projects/8',query:{}},{path:'https://evil.test',query:{}},{path:'/projects/7/register/1',query:{}},null,'bad']) expect(projectEntryLocation(7, '/projects', candidate).path).toBe('/projects/7')
  })
})
