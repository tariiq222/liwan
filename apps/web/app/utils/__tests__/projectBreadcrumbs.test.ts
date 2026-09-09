import { describe, expect, it } from 'vitest'
import { projectBreadcrumbs } from '../projectBreadcrumbs'
import { projectSidebarLinks } from '../../composables/useNav'

const identity = { is_admin: true, capabilities: ['pmo.projects.read', 'pmo.tasks.read', 'pmo.settings.manage'] }
const links = projectSidebarLinks(1, identity, true, true)
describe('project navigation hierarchy', () => {
  it.each([
    ['/projects', 'nav.projects'], ['/projects/dashboard', 'nav.projectDashboard'], ['/projects/new', 'nav.newProject'],
    ['/projects/1', 'nav.projectTasks'], ['/projects/1/charter', 'nav.projectCharter'], ['/projects/1/settings', 'nav.projectSettings'],
    ['/projects/1/schedule', 'projects.planningLinks.schedule'], ['/projects/1/raci', 'projects.planningLinks.raci'],
    ['/projects/1/updates', 'projects.tabs.updates'], ['/projects/1/updates/new', 'nav.breadcrumbCreate'],
    ['/projects/1/milestones/new', 'nav.breadcrumbCreate'], ['/projects/1/milestones/1/edit', 'app.edit'],
    ['/projects/1/tasks/new', 'nav.breadcrumbCreate'], ['/projects/1/tasks/1', 'nav.breadcrumbDetails'],
    ['/projects/1/schedule/tasks/1', 'nav.breadcrumbDetails'],
    ...['finance', 'stakeholders', 'register'].flatMap(section => [
      [`/projects/1/${section}/new`, 'nav.breadcrumbCreate'],
      [`/projects/1/${section}/1`, 'nav.breadcrumbDetails'],
      [`/projects/1/${section}/1/edit`, 'app.edit'],
    ]),
    ['/settings/projects', 'settings.projects.title'],
    ['/settings/projects/catalogs/types', 'settings.projects.catalogs.types'],
    ['/settings/projects/catalogs/owning-units/new', 'nav.breadcrumbCreate'],
    ['/settings/projects/catalogs/types/1/edit', 'app.edit'],
  ])('maps %s to its actual level', (path, label) => {
    expect(projectBreadcrumbs(path!, {}, links, 'Alpha').at(-1)?.labelKey).toBe(label)
  })
  it('retains intermediate record links for edit but never invents milestone detail routes', () => {
    const edit = projectBreadcrumbs('/projects/1/finance/9/edit', { returnTo: '/projects/1/finance/9?returnTo=%2Fprojects%2F1%2Ffinance%3Fkind%3Dcost' }, links)
    expect(edit.find(c => c.key === 'record')?.to).toBe('/projects/1/finance/9?returnTo=%2Fprojects%2F1%2Ffinance%3Fkind%3Dcost')
    expect(edit.find(c => c.key === 'section')?.to).toBe('/projects/1/finance?kind=cost')
    expect(projectBreadcrumbs('/projects/1/milestones/9/edit', {}, links).map(c => c.key)).not.toContain('record')
  })
  it('distinguishes root views and preserves list origin without accepting external returns', () => {
    expect(projectBreadcrumbs('/projects', { mine: '1' }, links).at(-1)?.labelKey).toBe('nav.myProjects')
    expect(projectBreadcrumbs('/projects/1', { tab: 'milestones' }, links).at(-1)?.labelKey).toBe('projects.tabs.milestones')
    expect(projectBreadcrumbs('/projects/1', { tab: 'summary' }, links).at(-1)?.labelKey).toBe('nav.projectSummary')
    expect(projectBreadcrumbs('/projects/1/charter', { edit: '1' }, links).at(-1)?.labelKey).toBe('app.edit')
    expect(projectBreadcrumbs('/projects/new', { returnTo: '//evil.test' }, links)[0]?.to).toBe('/projects')
    expect(projectBreadcrumbs('/projects/new', { returnTo: '/projects?mine=1&q=alpha' }, links)[0]?.to).toBe('/projects?mine=1&q=alpha')
  })
})
