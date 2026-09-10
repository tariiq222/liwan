import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { ShellContextLink } from '../composables/useNav'
import { projectBreadcrumbs, type ProjectCrumb } from './projectBreadcrumbs'
import { safeReturnTo } from './safeReturnTo'

export type WorkspaceCrumb = ProjectCrumb

type Query = Record<string, unknown>

function normalizedPath(path: string): string {
  return path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
}

function linkFor(links: ShellContextLink[], id: string, fallback: string, to: RouteLocationRaw): WorkspaceCrumb {
  const link = links.find(item => item.id === id)
  return { key: id, labelKey: link?.labelKey ?? fallback, to: link?.to ?? to }
}

function listLink(key: string, labelKey: string, path: string, query: Query, allowed: readonly string[]): WorkspaceCrumb {
  return { key, labelKey, to: ancestor(path, query, path, allowed) }
}

/** Resolve a real ancestor from nested returnTo values while rejecting external URLs. */
function ancestor(path: string, query: Query, fallback: RouteLocationRaw, allowed: readonly string[]): RouteLocationRaw {
  let candidate = query.returnTo
  for (let depth = 0; depth < 6; depth++) {
    const safe = safeReturnTo(candidate, '', allowed)
    if (!safe) break
    const url = new URL(safe, 'http://nasq.local')
    if (url.pathname === path) return safe
    candidate = url.searchParams.get('returnTo')
  }
  return fallback
}

function recordLink(path: string, query: Query, root: string, allowed: readonly string[]): RouteLocationRaw {
  const rootReturn = safeReturnTo(query.returnTo, root, allowed)
  return ancestor(path, query, { path, query: { returnTo: rootReturn } }, allowed)
}

function actionCrumb(labelKey: string): WorkspaceCrumb {
  return { key: 'action', labelKey }
}

function createCrumb(): WorkspaceCrumb {
  return { key: 'create', labelKey: 'nav.breadcrumbCreate' }
}

function editCrumb(): WorkspaceCrumb {
  return { key: 'edit', labelKey: 'app.edit' }
}

function taskBreadcrumbs(path: string, query: Query, links: ShellContextLink[]): WorkspaceCrumb[] {
  const allowed = ['/tasks', '/archived-tasks'] as const
  const tasks = listLink('tasks', 'nav.tasks', '/tasks', query, allowed)
  if (path === '/tasks') return [{ ...tasks, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/archived-tasks') {
    return [tasks, { ...linkFor(links, 'archived-tasks', 'nav.archivedTasks', path), to: { path, query: query as LocationQueryRaw } }]
  }
  if (path === '/tasks/new') return [tasks, createCrumb()]
  const match = path.match(/^\/tasks\/(\d+)(?:\/(edit))?$/)
  if (!match) return []
  const detailPath = `/tasks/${match[1]}`
  const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/tasks', allowed) }
  return match[2] ? [tasks, details, editCrumb()] : [tasks, details]
}

function meetingsBreadcrumbs(path: string, query: Query, links: ShellContextLink[]): WorkspaceCrumb[] {
  const allowed = ['/meetings'] as const
  const meetings = listLink('meetings', 'nav.meetings', '/meetings', query, allowed)
  if (path === '/meetings') return [{ ...meetings, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/meetings/calendar') return [meetings, { ...linkFor(links, 'meeting-calendar', 'nav.meetingCalendar', path), to: { path, query: query as LocationQueryRaw } }]
  const series = linkFor(links, 'meeting-series', 'nav.meetingSeries', '/meetings/series')
  const seriesAncestor: WorkspaceCrumb = { ...series, to: ancestor('/meetings/series', query, series.to ?? '/meetings/series', allowed) }
  if (path === '/meetings/series') return [meetings, { ...series, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/meetings/new') return [meetings, createCrumb()]
  if (path === '/meetings/series/new') return [meetings, seriesAncestor, createCrumb()]
  const seriesMatch = path.match(/^\/meetings\/series\/(\d+)(?:\/(edit))?$/)
  if (seriesMatch) {
    const detailPath = `/meetings/series/${seriesMatch[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/meetings/series', allowed) }
    return seriesMatch[2] ? [meetings, seriesAncestor, details, editCrumb()] : [meetings, seriesAncestor, details]
  }
  const minutesMatch = path.match(/^\/meetings\/(\d+)\/minutes$/)
  if (minutesMatch) {
    const detailPath = `/meetings/${minutesMatch[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/meetings', allowed) }
    return [meetings, details, actionCrumb('meetingsUx.minutesEditorTitle')]
  }
  const resolutionCreateMatch = path.match(/^\/meetings\/(\d+)\/resolutions\/new$/)
  if (resolutionCreateMatch) {
    const detailPath = `/meetings/${resolutionCreateMatch[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/meetings', allowed) }
    return [meetings, details, createCrumb()]
  }
  const resolutionEditMatch = path.match(/^\/meetings\/(\d+)\/resolutions\/(\d+)\/edit$/)
  if (resolutionEditMatch) {
    const detailPath = `/meetings/${resolutionEditMatch[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/meetings', allowed) }
    return [meetings, details, editCrumb()]
  }
  const match = path.match(/^\/meetings\/(\d+)(?:\/(edit))?$/)
  if (!match) return []
  const detailPath = `/meetings/${match[1]}`
  const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/meetings', allowed) }
  return match[2] ? [meetings, details, editCrumb()] : [meetings, details]
}

function hrBreadcrumbs(path: string, query: Query, links: ShellContextLink[]): WorkspaceCrumb[] {
  const allowed = ['/hr'] as const
  const employees = linkFor(links, 'employees', 'nav.employees', '/hr')
  const departments = linkFor(links, 'departments', 'nav.departments', '/hr/departments')
  const documents = linkFor(links, 'documents', 'nav.documents', '/hr/documents')
  const employeesAncestor: WorkspaceCrumb = { ...employees, to: ancestor('/hr', query, employees.to ?? '/hr', allowed) }
  const departmentsAncestor: WorkspaceCrumb = { ...departments, to: ancestor('/hr/departments', query, departments.to ?? '/hr/departments', allowed) }
  const documentsAncestor: WorkspaceCrumb = { ...documents, to: ancestor('/hr/documents', query, documents.to ?? '/hr/documents', allowed) }
  if (path === '/hr') return [{ ...employees, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/hr/documents') return [employeesAncestor, { ...documentsAncestor, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/hr/documents/new') return [employeesAncestor, documentsAncestor, createCrumb()]
  if (path === '/hr/departments') return [employeesAncestor, { ...departmentsAncestor, to: { path, query: query as LocationQueryRaw } }]
  if (path === '/hr/departments/new') return [employeesAncestor, departmentsAncestor, createCrumb()]

  const departmentDocuments = path.match(/^\/hr\/departments\/(\d+)\/documents(?:\/(new|\d+)(?:\/(edit))?)?$/)
  if (departmentDocuments) {
    const departmentPath = `/hr/departments/${departmentDocuments[1]}`
    const documentRouteBase = `${departmentPath}/documents`
    const documentSection: WorkspaceCrumb = { ...documents, key: 'documents', to: recordLink(departmentPath, query, '/hr/departments', allowed) }
    if (departmentDocuments[2] === 'new') return [employeesAncestor, departmentsAncestor, documentSection, createCrumb()]
    if (departmentDocuments[2]) {
      const detailPath = `${documentRouteBase}/${departmentDocuments[2]}`
      const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, departmentPath, allowed) }
      return departmentDocuments[3] ? [employeesAncestor, departmentsAncestor, documentSection, details, editCrumb()] : [employeesAncestor, departmentsAncestor, documentSection, details]
    }
    return [employeesAncestor, departmentsAncestor, documentSection]
  }

  const employee = path.match(/^\/hr\/employees\/(new|\d+)(?:\/(edit))?$/)
  if (employee) {
    if (employee[1] === 'new') return [employeesAncestor, createCrumb()]
    const detailPath = `/hr/employees/${employee[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/hr', allowed) }
    return employee[2] ? [employeesAncestor, details, editCrumb()] : [employeesAncestor, details]
  }
  const department = path.match(/^\/hr\/departments\/(\d+)(?:\/(edit))?$/)
  if (department) {
    const detailPath = `/hr/departments/${department[1]}`
    const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, '/hr/departments', allowed) }
    return department[2] ? [employeesAncestor, departmentsAncestor, details, editCrumb()] : [employeesAncestor, departmentsAncestor, details]
  }
  return []
}

function settingsBreadcrumbs(path: string, query: Query, links: ShellContextLink[]): WorkspaceCrumb[] {
  const allowed = ['/account', '/settings'] as const
  const settings: WorkspaceCrumb = { key: 'settings', labelKey: 'nav.settings', to: '/settings/appearance' }
  if (path === '/account') return [settings, { ...linkFor(links, 'account', 'nav.account', path), to: { path, query: query as LocationQueryRaw } }]
  const match = path.match(/^\/settings\/(appearance|branding|users|roles|access-log)(?:\/(new|\d+)(?:\/(access|security|edit))?)?$/)
  if (!match) return []
  const id = match[1]!
  const sectionPath = `/settings/${id}`
  const section = linkFor(links, id, id === 'access-log' ? 'nav.accessLog' : id === 'users' ? 'nav.users' : id === 'roles' ? 'nav.roles' : `settings.${id}.title`, sectionPath)
  const sectionAncestor: WorkspaceCrumb = { ...section, to: ancestor(sectionPath, query, section.to ?? sectionPath, allowed) }
  if (!match[2]) return [settings, { ...sectionAncestor, to: { path, query: query as LocationQueryRaw } }]
  if (match[2] === 'new') return [settings, sectionAncestor, createCrumb()]
  const detailPath = `${sectionPath}/${match[2]}`
  const details: WorkspaceCrumb = { key: 'record', labelKey: 'nav.breadcrumbDetails', to: recordLink(detailPath, query, sectionPath, allowed) }
  if (!match[3]) return [settings, sectionAncestor, details]
  const actionLabel = match[3] === 'access' ? 'access.users.editAccess' : match[3] === 'security' ? 'access.users.security' : 'app.edit'
  return [settings, sectionAncestor, details, actionCrumb(actionLabel)]
}

/**
 * Returns sidebar breadcrumbs for every workspace module. Project paths are
 * deliberately delegated to the existing implementation so their output is
 * unchanged; chat and global utility pages retain their empty breadcrumb row.
 */
export function workspaceBreadcrumbs(path: string, query: Query, links: ShellContextLink[], projectName?: string): WorkspaceCrumb[] {
  const normalized = normalizedPath(path)
  if (normalized.startsWith('/projects/') || normalized === '/projects' || normalized.startsWith('/settings/projects')) {
    return projectBreadcrumbs(path, query, links, projectName)
  }
  if (normalized === '/chat' || normalized.startsWith('/chat/')) return []
  if (normalized === '/tasks' || normalized.startsWith('/tasks/') || normalized === '/archived-tasks') return taskBreadcrumbs(normalized, query, links)
  if (normalized === '/meetings' || normalized.startsWith('/meetings/')) return meetingsBreadcrumbs(normalized, query, links)
  if (normalized === '/hr' || normalized.startsWith('/hr/')) return hrBreadcrumbs(normalized, query, links)
  if (normalized === '/account' || normalized.startsWith('/settings/')) return settingsBreadcrumbs(normalized, query, links)
  return []
}
