import { describe, it, expect } from 'vitest'
import { savedProjectLocation, projectEntryLocation } from '../projectWorkspaceMemory'

const enabled={policy:'enabled',enabled:true,can_toggle:false} as const
const tools={planning:enabled,governance:enabled,finance:enabled}

describe('project workspace memory', () => {
  it('remembers a task section opened with an accepted trailing slash', () => {
    expect(projectEntryLocation(7, '/projects', savedProjectLocation('/projects/7/tasks/', { view: 'board', q: 'review' }))).toEqual({
      path: '/projects/7/tasks', query: { view: 'board', q: 'review', returnTo: '/projects', projectListReturnTo: '/projects' },
    })
  })
  it.each(['tasks', 'milestones'])('remembers the canonical %s section and its filters', section => {
    const saved = savedProjectLocation(`/projects/7/${section}`, { view: 'board', q: 'review', state: 'in_progress' })
    expect(projectEntryLocation(7, '/projects?mine=1', saved, tools)).toEqual({
      path: `/projects/7/${section}`,
      query: { view: 'board', q: 'review', state: 'in_progress', returnTo: '/projects?mine=1', projectListReturnTo: '/projects?mine=1' },
    })
  })
  it('retains both searches and pages of the responsibility matrix', () => {
    const query = { task_q: 'review', stakeholder_q: 'manager', task_page: '2', stakeholder_page: '3' }
    expect(savedProjectLocation('/projects/7/raci', query)?.query).toEqual(query)
  })
  it('keeps section filters while replacing the old list origin', () => {
    const saved = savedProjectLocation('/projects/7/register', { q: 'risk', kind: 'risk', returnTo: '/projects?mine=1' })
    expect(saved).toEqual({ path: '/projects/7/register', query: { q: 'risk', kind: 'risk' } })
    expect(projectEntryLocation(7, '/projects?q=new', saved, tools)).toEqual({ path: '/projects/7/register', query: { q: 'risk', kind: 'risk', returnTo: '/projects?q=new', projectListReturnTo: '/projects?q=new' } })
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

describe('tool-aware workspace restoration',()=>{
 it.each(['register','milestones','charter','finance','schedule'])('keeps the sanitized %s destination while metadata is unresolved',section=>{
  const saved=savedProjectLocation(`/projects/7/${section}`,{q:'review'})
  expect(projectEntryLocation(7,'/projects?mine=1',saved)).toEqual({path:`/projects/7/${section}`,query:{q:'review',returnTo:'/projects?mine=1',projectListReturnTo:'/projects?mine=1'}})
 })
 it('falls back to summary when the owning tool is confirmed disabled',()=>{
  const saved=savedProjectLocation('/projects/7/register',{q:'risk'})
  expect(projectEntryLocation(7,'/projects',saved,{...tools,governance:{...enabled,enabled:false}}).path).toBe('/projects/7')
 })
 it.each(['/projects/8/register','https://evil.test','//evil.test','/projects/7/register/new','/projects/7/tasks/9','/projects/7/settings'])('does not allow unsafe, cross-project or form route %s with unknown metadata',path=>{
  expect(projectEntryLocation(7,'/projects',{path,query:{q:'risk'}}).path).toBe('/projects/7')
 })
})
