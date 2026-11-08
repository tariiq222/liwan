import { describe, expect, it, vi } from 'vitest'
import manifest from '../manifest'
import { projectsSidebar } from '../sidebar'
import type { AppSearchApi, AppSidebarRoute } from '../../types'

const route = (path: string, query: Record<string, unknown> = {}): AppSidebarRoute => ({ path, query })
const activeRows = (current: AppSidebarRoute) => projectsSidebar.rows.filter(item => item.active(current)).map(item => item.id)

describe('the projects sidebar menu', () => {
  it('is the pmo manifest menu: a create link, four flat rows and the recent projects', () => {
    expect(manifest.sidebar).toBe(projectsSidebar)
    expect(manifest.contextLinks?.('/projects').find(link => link.id === projectsSidebar.create)).toMatchObject({ pinned: true, capability: 'pmo.projects.create' })
    expect(projectsSidebar.rows.map(item => [item.id, item.capability])).toEqual([
      ['project-dashboard', 'pmo.projects.read'], ['projects', 'pmo.projects.read'], ['tasks', 'pmo.tasks.read'], ['projects-attention', 'pmo.projects.read'],
    ])
    expect(projectsSidebar.recent).toMatchObject({ kind: 'project', capability: 'pmo.projects.read' })
    expect(projectsSidebar.recent!.to(12)).toBe('/projects/12')
  })

  it('lights one row per page', () => {
    expect(activeRows(route('/projects/dashboard'))).toEqual(['project-dashboard'])
    expect(activeRows(route('/projects'))).toEqual(['projects'])
    expect(activeRows(route('/projects/', { status: 'done' }))).toEqual(['projects'])
    expect(activeRows(route('/projects/new'))).toEqual(['projects'])
    expect(activeRows(route('/projects', { status: 'attention' }))).toEqual(['projects-attention'])
    expect(activeRows(route('/tasks', { assignee: 'me', view: 'board' }))).toEqual(['tasks'])
    expect(activeRows(route('/tasks/44'))).toEqual(['tasks'])
    expect(activeRows(route('/projects/12/tasks'))).toEqual([])
  })

  it('counts projects and attention from one summary, needs attention being at risk plus off track', async () => {
    const api = vi.fn().mockResolvedValue({
      project_count: 7, attention_project_count: 6, overdue_task_count: 0, totals: [], attention: [],
      status_counts: [{ status: 'on_track', count: 3 }, { status: 'at_risk', count: 2 }, { status: 'off_track', count: 1 }, { status: 'done', count: 1 }],
    })
    const loader = projectsSidebar.counts!.find(counts => counts.capability === 'pmo.projects.read')!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ projects: 7, 'projects-attention': 3 })
    expect(api).toHaveBeenCalledWith('/api/v1/reports/projects/summary', expect.objectContaining({}))
    expect(loader.queryKey.slice(0, 2)).toEqual(['projects', 'summary'])
  })

  it('counts my open tasks from the task summary of the assigned list', async () => {
    const api = vi.fn().mockResolvedValue({ total: 9, open: 4, overdue: 1, done: 5 })
    const loader = projectsSidebar.counts!.find(counts => counts.capability === 'pmo.tasks.read')!
    expect(await loader.load(api as unknown as AppSearchApi)).toEqual({ tasks: 4 })
    expect(api).toHaveBeenCalledWith('/api/v1/tasks/summary', expect.objectContaining({ query: { assignee: 'me' } }))
    expect(loader.queryKey.slice(0, 2)).toEqual(['tasks', 'summary'])
  })
})
