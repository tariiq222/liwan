import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import type { ShellContextLink } from '../composables/useNav'
import { projectListReturnTo } from './projectNavigation'
import { safeReturnTo } from './safeReturnTo'

export interface ProjectCrumb { key: string; labelKey?: string; label?: string; to?: RouteLocationRaw }

/** Recover an actual ancestor's URL, including its filters, without trusting external returns. */
function ancestor(path: string, query: Record<string, unknown>, fallback: RouteLocationRaw): RouteLocationRaw {
  let candidate = query.returnTo
  for (let depth = 0; depth < 6; depth++) {
    const safe = safeReturnTo(candidate, '', ['/projects', '/settings/projects'])
    if (!safe) break
    const url = new URL(safe, 'http://nasq.local')
    if (url.pathname === path) return safe
    candidate = url.searchParams.get('returnTo')
  }
  return fallback
}

export function projectBreadcrumbs(path: string, query: Record<string, unknown>, links: ShellContextLink[], projectName?: string): ProjectCrumb[] {
  const parts = path.split('/').filter(Boolean)
  const root: ProjectCrumb = { key: 'projects', labelKey: 'nav.projects', to: projectListReturnTo(query) }
  if (path === '/settings/projects' || path.startsWith('/settings/projects/')) {
    const crumbs: ProjectCrumb[] = [root, { key: 'system', labelKey: 'settings.projects.title', to: '/settings/projects' }]
    if (parts[2] === 'catalogs' && ['types', 'owning-units'].includes(parts[3] ?? '')) {
      const base = `/settings/projects/catalogs/${parts[3]}`
      crumbs.push({ key: 'catalog', labelKey: parts[3] === 'types' ? 'settings.projects.catalogs.types' : 'settings.projects.catalogs.owningUnits', to: ancestor(base, query, base) })
      if (parts.length > 4) crumbs.push({ key: 'action', labelKey: parts.at(-1) === 'new' ? 'nav.breadcrumbCreate' : 'app.edit' })
    }
    return crumbs
  }
  if (parts[0] !== 'projects') return []
  if (!parts[1]) return query.mine === '1' || query.mine === 'true'
    ? [{ ...root, to: '/projects' }, { key: 'mine', labelKey: 'nav.myProjects', to: { path, query: query as LocationQueryRaw } }]
    : [{ ...root, to: { path, query: query as LocationQueryRaw } }]
  if (parts[1] === 'dashboard') return [{ ...root, to: '/projects' }, { key: 'dashboard', labelKey: 'nav.projectDashboard', to: { path, query: query as LocationQueryRaw } }]
  if (parts[1] === 'new') return [root, { key: 'new', labelKey: 'nav.newProject' }]
  if (!/^\d+$/.test(parts[1]!)) return []
  const base = `/projects/${parts[1]}`
  const summary = links.find(link => link.id === 'summary')
  const crumbs: ProjectCrumb[] = [root, { key: 'project', label: projectName, labelKey: projectName ? undefined : 'nav.currentProject', to: summary?.to }]
  const sectionName = parts[2]
  const tab = String(query.tab ?? 'tasks')
  const sectionId = !sectionName ? (tab === 'summary' ? 'summary' : tab === 'milestones' ? 'milestones' : 'tasks')
    : ({ register: 'risks', settings: 'current-project-settings', raci: 'stakeholders', schedule: 'tasks', updates: 'summary' } as Record<string, string>)[sectionName] ?? sectionName
  const section = links.find(link => link.id === sectionId)
  if (section) crumbs.push({ key: 'section', labelKey: section.labelKey, to: ancestor(typeof section.to === 'string' ? section.to.split('?')[0]! : section.to.path!, query, section.to) })
  const special = ({ schedule: 'projects.planningLinks.schedule', raci: 'projects.planningLinks.raci', updates: 'projects.tabs.updates' } as Record<string, string>)[sectionName ?? '']
  const contextQuery = { projectListReturnTo: projectListReturnTo(query), ...(typeof query.taskContext === 'string' ? { taskContext: query.taskContext } : {}) }
  const target = (destination: string): RouteLocationRaw => ancestor(destination, query, { path: destination, query: contextQuery })
  if (special) crumbs.push({ key: 'subsection', labelKey: special, to: target(`${base}/${sectionName}`) })
  const tail = parts.slice(sectionName === 'schedule' && parts[3] === 'tasks' ? 4 : 3)
  if (tail[0] === 'new') crumbs.push({ key: 'create', labelKey: 'nav.breadcrumbCreate' })
  else if (tail.length) {
    const hasDetailPage = ['tasks', 'stakeholders', 'register', 'finance', 'schedule'].includes(sectionName ?? '')
    if (hasDetailPage) crumbs.push({ key: 'record', labelKey: 'nav.breadcrumbDetails', to: target(path.replace(/\/edit\/?$/, '')) })
    if (tail.at(-1) === 'edit') crumbs.push({ key: 'edit', labelKey: 'app.edit' })
  }
  if (sectionName === 'charter' && query.edit === '1') crumbs.push({ key: 'edit', labelKey: 'app.edit' })
  return crumbs
}
