import type { Component } from 'vue'
import { projectListReturnTo } from '../utils/projectNavigation'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { CheckSquare, FolderKanban, Users, Settings, Wrench, Network, Files, ShieldCheck, UserCog, History, SlidersHorizontal, Palette, MessageCircle, ChartNoAxesCombined, CalendarDays, CalendarRange, ClipboardList, CircleAlert, WalletCards, FileText, LayoutDashboard, LayoutTemplate, Grid3x3, House, Megaphone, Plus, Repeat } from '@lucide/vue'
import { hasCapability, INTERNAL_NASQ_ACCESS, type AccessIdentity } from '../utils/accessPolicy'

export type NavGroup = 'chat' | 'projects' | 'meetings' | 'hr' | 'settings'
/** Rail modules. `home` is the projects dashboard; tasks, templates, reports and search live under `projects`. */
export type ShellModule = NavGroup | 'home' | 'vendor'
export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string; group?: NavGroup; module?: ShellModule; capability: string }
const items: NavItem[] = [
  { to: '/projects/dashboard', labelKey: 'nav.home', icon: House, shortcut: 'h', group: 'projects', module: 'home', capability: 'pmo.projects.read' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2', group: 'projects', module: 'projects', capability: 'pmo.projects.read' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1', group: 'projects', module: 'projects', capability: 'pmo.tasks.read' },
  { to: '/project-templates', labelKey: 'nav.projectTemplates', icon: LayoutTemplate, shortcut: 't', group: 'projects', module: 'projects', capability: 'pmo.projects.read' },
  { to: '/meetings', labelKey: 'nav.meetings', icon: CalendarDays, shortcut: 'm', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/calendar', labelKey: 'nav.meetingCalendar', icon: CalendarDays, shortcut: 'k', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/series', labelKey: 'nav.meetingSeries', icon: Repeat, shortcut: 'y', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/chat', labelKey: 'nav.chat', icon: MessageCircle, shortcut: 'c', group: 'chat', module: 'chat', capability: 'nasq.internal' },
  { to: '/hr', labelKey: 'nav.employees', icon: Users, shortcut: '3', group: 'hr', module: 'hr', capability: 'hr.employees.read' },
  { to: '/hr/departments', labelKey: 'nav.departments', icon: Network, shortcut: '5', group: 'hr', module: 'hr', capability: 'hr.departments.read' },
  { to: '/hr/documents', labelKey: 'nav.documents', icon: Files, shortcut: '6', group: 'hr', module: 'hr', capability: 'hr.documents.read' },
  { to: '/settings/appearance', labelKey: 'settings.appearance.title', icon: SlidersHorizontal, shortcut: 'b', group: 'settings', module: 'settings', capability: 'nasq.internal' },
  { to: '/settings/branding', labelKey: 'settings.branding.title', icon: Palette, shortcut: 'g', group: 'settings', module: 'settings', capability: 'settings.branding.manage' },
  { to: '/settings/projects', labelKey: 'settings.projects.title', icon: Settings, shortcut: '4', group: 'settings', module: 'settings', capability: 'pmo.settings.manage' },
  { to: '/settings/users', labelKey: 'nav.users', icon: UserCog, shortcut: '7', group: 'settings', module: 'settings', capability: 'access.users.read' },
  { to: '/settings/roles', labelKey: 'nav.roles', icon: ShieldCheck, shortcut: '8', group: 'settings', module: 'settings', capability: 'access.roles.read' },
  { to: '/settings/access-log', labelKey: 'nav.accessLog', icon: History, shortcut: '9', group: 'settings', module: 'settings', capability: 'access.audit.read' },
]
export function useNav(identity: AccessIdentity): NavItem[] {
  const visible = items.filter(item => (
    item.capability === 'nasq.internal'
      ? Array.isArray(identity?.capabilities)
      : hasCapability(identity, item.capability)
  ))
  if (identity?.role === 'vendor' && identity.capabilities?.length) visible.push({ to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's', module: 'vendor', capability: 'vendor' })
  return visible
}

export interface ShellModuleDefinition {
  id: ShellModule
  labelKey: string
  icon: Component
  to: string
}

/** Rail order (user decision 2026-09-11); settings and the vendor console stay in the utility slot. */
export const shellModules: ShellModuleDefinition[] = [
  { id: 'home', labelKey: 'nav.home', icon: House, to: '/projects/dashboard' },
  { id: 'projects', labelKey: 'nav.projects', icon: FolderKanban, to: '/projects' },
  { id: 'meetings', labelKey: 'nav.meetings', icon: CalendarDays, to: '/meetings' },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, to: '/chat' },
  { id: 'hr', labelKey: 'nav.organization', icon: Users, to: '/hr' },
  { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: '/settings/appearance' },
  { id: 'vendor', labelKey: 'nav.console', icon: Wrench, to: '/odoo' },
]

export function visibleShellModules(identity: AccessIdentity): ShellModuleDefinition[] {
  const nav = useNav(identity)
  return shellModules.flatMap(module => {
    const destinations = nav.filter(item => item.module === module.id)
    if (!destinations.length) return []
    return [{ ...module, to: destinations.find(item => item.to === module.to)?.to ?? destinations[0]!.to }]
  })
}

export function activeShellModule(path: string): ShellModule | null {
  if (path === '/projects/dashboard' || path.startsWith('/projects/dashboard/')) return 'home'
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat'
  if (path === '/meetings' || path.startsWith('/meetings/')) return 'meetings'
  if (path === '/hr' || path.startsWith('/hr/')) return 'hr'
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  if (path === '/reports' || path.startsWith('/reports/')) return 'projects'
  if (path === '/tasks' || path.startsWith('/tasks/') || path === '/archived-tasks') return 'projects'
  if (path === '/projects' || path.startsWith('/projects/') || path === '/project-templates' || path.startsWith('/project-templates/')) return 'projects'
  if (path === '/account' || path.startsWith('/account/')) return 'settings'
  if (path === '/search' || path.startsWith('/search/')) return 'projects'
  if (path === '/notifications' || path.startsWith('/notifications/')) return null
  if (path === '/notification-digests' || path.startsWith('/notification-digests/')) return null
  if (path === '/odoo' || path.startsWith('/odoo/')) return 'vendor'
  return null
}

/** The module whose contextual links a rail module shows; `home` shares the projects sidebar. */
export function contextModuleFor(module: ShellModule | null): ShellModule | null {
  return module === 'home' ? 'projects' : module
}

export interface ShellContextLink {
  id: string
  labelKey: string
  icon: Component
  to: RouteLocationRaw
  capability: string
  active?: boolean
  pinned?: boolean
}
type ShellQuery = LocationQueryRaw

export const PROJECT_CONTEXT_IDS = ['summary', 'planning', 'stakeholders', 'risks', 'finance', 'charter', 'settings'] as const
export type ProjectContextId = typeof PROJECT_CONTEXT_IDS[number]

export const PROJECT_WORKSPACE_TAB_IDS = ['tasks', 'summary', 'milestones', 'schedule', 'stakeholders', 'raci', 'risks', 'finance', 'charter', 'updates', 'settings'] as const
export type ProjectWorkspaceTabId = typeof PROJECT_WORKSPACE_TAB_IDS[number]

export const PROJECT_WORKSPACE_GROUP_IDS = ['overview', 'execution', 'governance', 'finance', 'updates'] as const
export type ProjectWorkspaceGroupId = typeof PROJECT_WORKSPACE_GROUP_IDS[number]

const PROJECT_TAB_CONTEXT: Record<ProjectWorkspaceTabId, ProjectContextId> = {
  tasks: 'planning', milestones: 'planning', schedule: 'planning',
  summary: 'summary', updates: 'summary',
  stakeholders: 'stakeholders', raci: 'stakeholders',
  risks: 'risks', finance: 'finance', charter: 'charter', settings: 'settings',
}

const PROJECT_TAB_GROUP: Record<ProjectWorkspaceTabId, ProjectWorkspaceGroupId | null> = {
  summary: 'overview',
  tasks: 'execution', schedule: 'execution', milestones: 'execution',
  charter: 'governance', stakeholders: 'governance', raci: 'governance', risks: 'governance',
  finance: 'finance', updates: 'updates', settings: null,
}

function projectWorkspaceTabOf(path: string, query: Record<string, unknown>): ProjectWorkspaceTabId | null {
  const match = path.match(/^\/projects\/([^/]+)/)
  if (!match) return null
  const rest = path.replace(match[0], '').replace(/^\//, '')
  if (rest === 'settings') return 'settings'
  if (rest === 'charter') return 'charter'
  if (rest === 'updates' || rest.startsWith('updates/')) return 'updates'
  if (rest === 'finance' || rest.startsWith('finance/')) return 'finance'
  if (rest === 'raci') return 'raci'
  if (rest === 'stakeholders' || rest.startsWith('stakeholders/')) return 'stakeholders'
  if (rest === 'register' || rest.startsWith('register/')) return 'risks'
  if (rest === 'milestones' || rest.startsWith('milestones/')) return 'milestones'
  if (rest === 'schedule' || rest.startsWith('schedule/')) return 'schedule'
  if (rest === 'tasks' || rest.startsWith('tasks/')) return 'tasks'
  if (query.tab === 'milestones') return 'milestones'
  if (query.tab === 'tasks' || query.tab === 'list' || query.tab === 'board') return 'tasks'
  if (query.tab === 'summary') return 'summary'
  if (query.view === 'board' || query.view === 'tasks' || query.view === 'list') return 'tasks'
  return 'summary'
}

/**
 * Maps a project route to its contextual section. The precise form
 * distinguishes the workspace sub-sections (schedule, milestones, RACI,
 * updates) that the in-page tabs need; the default form keeps the coarser
 * section ids used by section roots and breadcrumbs.
 */
export function projectContextId(path: string, query?: Record<string, unknown>): ProjectContextId | null
export function projectContextId(path: string, query: Record<string, unknown>, precise: true): ProjectWorkspaceTabId | null
export function projectContextId(path: string, query: Record<string, unknown> = {}, precise = false): ProjectContextId | ProjectWorkspaceTabId | null {
  const tab = projectWorkspaceTabOf(path, query)
  if (tab === null || precise) return tab
  return PROJECT_TAB_CONTEXT[tab]
}

function hrCreateLinkForPath(path?: string): ShellContextLink {
  if (path?.startsWith('/hr/documents') || /^\/hr\/departments\/[^/]+\/documents(?:\/|$)/.test(path ?? '')) {
    return { id: 'new-document', labelKey: 'hr.docs.new', icon: Plus, to: '/hr/documents/new', capability: 'hr.documents.manage', pinned: true }
  }
  if (path?.startsWith('/hr/departments')) {
    return { id: 'new-department', labelKey: 'hr.depts.new', icon: Plus, to: '/hr/departments/new', capability: 'hr.departments.manage', pinned: true }
  }
  return { id: 'new-employee', labelKey: 'hr.directory.newEmployee', icon: Plus, to: '/hr/employees/new', capability: 'hr.employees.manage', pinned: true }
}

/** Hide the pinned create on the projects list/form and inside a project workspace. */
export function hidePinnedNewProject(path: string): boolean {
  const normalized = path.split(/[?#]/, 1)[0]!.replace(/\/+$/, '') || '/'
  return normalized === '/projects' || normalized === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(normalized)
}

/** Projects sidebar: shown for `home` and `projects`, including inside a project (2026-09-11). */
const projectsContextLinks: ShellContextLink[] = [
  { id: 'new-project', labelKey: 'nav.newProject', icon: Plus, to: '/projects/new', capability: 'pmo.projects.create', pinned: true },
  { id: 'project-dashboard', labelKey: 'nav.projectDashboard', icon: ChartNoAxesCombined, to: '/projects/dashboard', capability: 'pmo.projects.read' },
  { id: 'projects', labelKey: 'nav.allProjects', icon: FolderKanban, to: '/projects', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: CheckSquare, to: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'project-templates', labelKey: 'nav.projectTemplates', icon: LayoutTemplate, to: '/project-templates', capability: 'pmo.projects.read' },
]

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  const links: ShellContextLink[] = {
    home: projectsContextLinks,
    projects: projectsContextLinks,
    chat: [
      { id: 'new-chat', labelKey: 'nav.newConversation', icon: Plus, to: '/chat/new', capability: INTERNAL_NASQ_ACCESS, pinned: true },
      { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, to: '/chat', capability: INTERNAL_NASQ_ACCESS },
    ],
    meetings: [
      { id: 'new-meeting', labelKey: 'nav.newMeeting', icon: Plus, to: '/meetings/new', capability: 'meetings.create', pinned: true },
      { id: 'meetings', labelKey: 'nav.meetings', icon: CalendarDays, to: '/meetings', capability: 'meetings.read' },
      { id: 'meeting-calendar', labelKey: 'nav.meetingCalendar', icon: CalendarDays, to: '/meetings/calendar', capability: 'meetings.read' },
      { id: 'meeting-series', labelKey: 'nav.meetingSeries', icon: Repeat, to: '/meetings/series', capability: 'meetings.read' },
    ],
    hr: [
      hrCreateLinkForPath(path),
      { id: 'employees', labelKey: 'nav.employees', icon: Users, to: '/hr', capability: 'hr.employees.read' },
      { id: 'departments', labelKey: 'nav.departments', icon: Network, to: '/hr/departments', capability: 'hr.departments.read' },
      { id: 'documents', labelKey: 'nav.documents', icon: Files, to: '/hr/documents', capability: 'hr.documents.read' },
    ],
    settings: [
      { id: 'account', labelKey: 'nav.account', icon: UserCog, to: '/account', capability: INTERNAL_NASQ_ACCESS },
      { id: 'appearance', labelKey: 'settings.appearance.title', icon: SlidersHorizontal, to: '/settings/appearance', capability: INTERNAL_NASQ_ACCESS },
      { id: 'users', labelKey: 'nav.users', icon: UserCog, to: '/settings/users', capability: 'access.users.read' },
      { id: 'roles', labelKey: 'nav.roles', icon: ShieldCheck, to: '/settings/roles', capability: 'access.roles.read' },
      { id: 'access-log', labelKey: 'nav.accessLog', icon: History, to: '/settings/access-log', capability: 'access.audit.read' },
      { id: 'branding', labelKey: 'settings.branding.title', icon: Palette, to: '/settings/branding', capability: 'settings.branding.manage' },
      { id: 'project-settings', labelKey: 'settings.projects.title', icon: Settings, to: '/settings/projects', capability: 'pmo.settings.manage' },
    ],
    vendor: [
      { id: 'console', labelKey: 'nav.console', icon: Wrench, to: '/odoo', capability: 'vendor' },
    ],
  }[module]
  return links.filter(link => hasCapability(identity, link.capability))
}

export interface ShellContextGroup {
  id: 'default'
  labelKey?: string
  links: ShellContextLink[]
}

/**
 * The one grouping used by the desktop sidebar and the mobile menu. Every
 * module is a flat list (pinned create actions first, then navigation); the
 * module and path stay in the signature so a future grouped module has one
 * place to declare itself.
 */
export function shellContextGroups(module: ShellModule, identity: AccessIdentity, path: string | undefined, links: ShellContextLink[]): ShellContextGroup[] {
  void module
  void path
  const permitted = links.filter(link => hasCapability(identity, link.capability))
  const ordered = [...permitted.filter(link => link.pinned), ...permitted.filter(link => !link.pinned)]
  return ordered.length ? [{ id: 'default', links: ordered }] : []
}

/** Convenience wrapper: module links grouped for the sidebar. */
export function contextGroupsForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextGroup[] {
  return shellContextGroups(module, identity, path, contextLinksForModule(module, identity, path))
}

function projectContextQueries(projectId: number, taskQuery: ShellQuery, isProjectRoot: boolean) {
  const base = `/projects/${projectId}`
  const taskKeys = ['q', 'state', 'closed', 'view'] as const
  let remembered: ShellQuery = {}
  if (typeof taskQuery.taskContext === 'string') {
    try {
      const value = JSON.parse(taskQuery.taskContext)
      if (value && typeof value === 'object') for (const key of taskKeys) {
        if (typeof value[key] === 'string') remembered[key] = value[key]
      }
    } catch { /* Ignore invalid URL state. */ }
  }
  if (['tasks', 'list', 'board', 'milestones'].includes(String(taskQuery.tab)) || (isProjectRoot && taskQuery.tab == null)) {
    remembered = Object.fromEntries(taskKeys.filter(key => typeof taskQuery[key] === 'string').map(key => [key, taskQuery[key]]))
    if (taskQuery.tab === 'board') remembered.view = 'board'
  }
  const listReturnTo = projectListReturnTo(taskQuery)
  const rootQuery = { taskContext: JSON.stringify(remembered), projectListReturnTo: listReturnTo, returnTo: listReturnTo }
  const projectReturnTo = `${base}?${new URLSearchParams(rootQuery)}`
  const contextQuery: ShellQuery = { ...rootQuery, returnTo: projectReturnTo }
  return { base, remembered, rootQuery, contextQuery }
}

export function projectContextLinks(
  projectId: number,
  identity: AccessIdentity,
  activeProject: boolean,
  canManage: boolean,
  taskQuery: ShellQuery = {},
  isProjectRoot = false,
): ShellContextLink[] {
  const { base, remembered, rootQuery, contextQuery } = projectContextQueries(projectId, taskQuery, isProjectRoot)
  const links: ShellContextLink[] = [
    { id: 'summary', labelKey: 'nav.projectSummary', icon: LayoutDashboard, to: { path: base, query: { ...rootQuery, tab: 'summary' } }, capability: 'pmo.projects.read' },
    { id: 'planning', labelKey: 'nav.projectPlanning', icon: ClipboardList, to: { path: base, query: { ...rootQuery, ...remembered, tab: 'tasks' } }, capability: 'pmo.tasks.read' },
    { id: 'stakeholders', labelKey: 'nav.projectStakeholders', icon: Users, to: { path: `${base}/stakeholders`, query: contextQuery }, capability: 'pmo.projects.read' },
    { id: 'risks', labelKey: 'nav.projectRisks', icon: CircleAlert, to: { path: `${base}/register`, query: contextQuery }, capability: 'pmo.projects.read' },
    { id: 'finance', labelKey: 'nav.projectFinance', icon: WalletCards, to: { path: `${base}/finance`, query: contextQuery }, capability: 'pmo.projects.read' },
    { id: 'charter', labelKey: 'nav.projectCharter', icon: FileText, to: { path: `${base}/charter`, query: contextQuery }, capability: 'pmo.projects.read' },
    { id: 'settings', labelKey: 'nav.projectSettings', icon: Settings, to: { path: `${base}/settings`, query: contextQuery }, capability: 'pmo.projects.manage' },
  ]
  return links.filter(link => activeProject || !['planning', 'stakeholders', 'risks', 'charter'].includes(link.id))
    .filter(link => link.id === 'settings' ? canManage : hasCapability(identity, link.capability))
}

/**
 * Direct section routes with task view state, one reusable source for the
 * workspace tabs and the sidebar breadcrumb.
 */
export function projectWorkspaceLinks(
  projectId: number,
  identity: AccessIdentity,
  activeProject: boolean,
  canManage: boolean,
  taskQuery: ShellQuery = {},
  isProjectRoot = false,
): ShellContextLink[] {
  const context = projectContextLinks(projectId, identity, activeProject, canManage, taskQuery, isProjectRoot)
  const byId = new Map(context.map(link => [link.id, link]))
  const planning = byId.get('planning')
  const summary = byId.get('summary')
  const queryOf = (link: ShellContextLink | undefined): ShellQuery => {
    if (!link || typeof link.to === 'string' || Array.isArray(link.to)) return {}
    return 'query' in link.to && link.to.query ? link.to.query as ShellQuery : {}
  }
  const { view: _taskView, ...planningQuery } = queryOf(planning)
  const milestonesQuery = { ...planningQuery, tab: 'milestones' }
  const tasksQuery = { ...queryOf(planning), tab: 'tasks' }
  const summaryQuery = { ...queryOf(summary), tab: 'summary' }
  const stakeholdersQuery = queryOf(byId.get('stakeholders'))
  const risksQuery = queryOf(byId.get('risks'))
  const financeQuery = queryOf(byId.get('finance'))
  const charterQuery = queryOf(byId.get('charter'))
  const links: Array<ShellContextLink & { id: ProjectWorkspaceTabId }> = [
    { id: 'tasks', labelKey: 'nav.projectTasks', icon: ClipboardList, to: { path: `/projects/${projectId}`, query: tasksQuery }, capability: 'pmo.tasks.read' },
    { id: 'summary', labelKey: 'nav.projectSummary', icon: LayoutDashboard, to: { path: `/projects/${projectId}`, query: summaryQuery }, capability: 'pmo.projects.read' },
    { id: 'milestones', labelKey: 'projects.tabs.milestones', icon: ClipboardList, to: { path: `/projects/${projectId}`, query: milestonesQuery }, capability: 'pmo.tasks.read' },
    { id: 'stakeholders', labelKey: 'nav.projectStakeholders', icon: Users, to: { path: `/projects/${projectId}/stakeholders`, query: stakeholdersQuery }, capability: 'pmo.projects.read' },
    { id: 'risks', labelKey: 'nav.projectRisks', icon: CircleAlert, to: { path: `/projects/${projectId}/register`, query: risksQuery }, capability: 'pmo.projects.read' },
    { id: 'finance', labelKey: 'nav.projectFinance', icon: WalletCards, to: { path: `/projects/${projectId}/finance`, query: financeQuery }, capability: 'pmo.projects.read' },
    { id: 'charter', labelKey: 'nav.projectCharter', icon: FileText, to: { path: `/projects/${projectId}/charter`, query: charterQuery }, capability: 'pmo.projects.read' },
  ]
  return links.filter(link => activeProject || !['tasks', 'milestones', 'stakeholders', 'risks', 'charter'].includes(link.id))
    .filter(link => hasCapability(identity, link.capability))
}

/**
 * Section links plus the record-gated settings entry. Since 2026-09-11 the
 * sidebar no longer renders this list; it feeds the sidebar breadcrumb and
 * the in-page workspace tabs.
 */
export function projectSidebarLinks(
  projectId: number,
  identity: AccessIdentity,
  activeProject: boolean,
  canManage: boolean,
  taskQuery: ShellQuery = {},
  isProjectRoot = false,
): ShellContextLink[] {
  const settings = projectContextLinks(projectId, identity, activeProject, canManage, taskQuery, isProjectRoot)
    .find(link => link.id === 'settings')
  const sections = projectWorkspaceLinks(projectId, identity, activeProject, canManage, taskQuery, isProjectRoot)
  return [
    ...sections,
    ...(settings ? [{ ...settings, id: 'current-project-settings' }] : []),
  ]
}

export type ProjectWorkspaceTabLink = ShellContextLink & { id: ProjectWorkspaceTabId }
export interface ProjectWorkspaceGroup {
  id: ProjectWorkspaceGroupId
  labelKey: string
  icon: Component
  to: RouteLocationRaw
  /** Sub-sections rendered as a second tab row; empty for single-page groups. */
  links: ProjectWorkspaceTabLink[]
}
export interface ProjectWorkspaceModel {
  groups: ProjectWorkspaceGroup[]
  activeGroup: ProjectWorkspaceGroupId | null
  activeTab: ProjectWorkspaceTabId | null
}

/**
 * The in-page project tab model (2026-09-11): الملخص · التنفيذ · الحوكمة ·
 * المالية · التحديثات, with sub-sections under execution and governance.
 * Archived projects and missing `pmo.tasks.read` hide the same sections as
 * projectWorkspaceLinks; a group with no visible sub-section is hidden.
 */
export function projectWorkspaceGroups(
  projectId: number,
  identity: AccessIdentity,
  activeProject: boolean,
  canManage: boolean,
  taskQuery: ShellQuery = {},
  isProjectRoot = false,
  path?: string,
): ProjectWorkspaceModel {
  const { base, contextQuery } = projectContextQueries(projectId, taskQuery, isProjectRoot)
  const sections = projectWorkspaceLinks(projectId, identity, activeProject, canManage, taskQuery, isProjectRoot) as ProjectWorkspaceTabLink[]
  const byId = new Map(sections.map(link => [link.id, link]))
  const canReadProject = hasCapability(identity, 'pmo.projects.read')
  const canReadTasks = hasCapability(identity, 'pmo.tasks.read')
  const schedule: ProjectWorkspaceTabLink | undefined = activeProject && canReadTasks
    ? { id: 'schedule', labelKey: 'projects.planningLinks.schedule', icon: CalendarRange, to: { path: `${base}/schedule`, query: contextQuery }, capability: 'pmo.tasks.read' }
    : undefined
  const raci: ProjectWorkspaceTabLink | undefined = activeProject && canReadProject
    ? { id: 'raci', labelKey: 'projects.workspace.sections.raci', icon: Grid3x3, to: { path: `${base}/raci`, query: contextQuery }, capability: 'pmo.projects.read' }
    : undefined
  const updates: ProjectWorkspaceTabLink | undefined = canReadProject
    ? { id: 'updates', labelKey: 'projects.tabs.updates', icon: Megaphone, to: { path: `${base}/updates`, query: contextQuery }, capability: 'pmo.projects.read' }
    : undefined
  const present = (links: Array<ProjectWorkspaceTabLink | undefined>) => links.filter((link): link is ProjectWorkspaceTabLink => Boolean(link))
  const single = (link: ProjectWorkspaceTabLink | undefined) => link ? { to: link.to, links: [] as ProjectWorkspaceTabLink[] } : null
  const nested = (links: ProjectWorkspaceTabLink[]) => links.length ? { to: links[0]!.to, links } : null
  const candidates: Array<{ id: ProjectWorkspaceGroupId; labelKey: string; icon: Component; body: { to: RouteLocationRaw; links: ProjectWorkspaceTabLink[] } | null }> = [
    { id: 'overview', labelKey: 'projects.workspace.groups.overview', icon: LayoutDashboard, body: single(byId.get('summary')) },
    { id: 'execution', labelKey: 'projects.workspace.groups.execution', icon: ClipboardList, body: nested(present([byId.get('tasks'), schedule, byId.get('milestones')])) },
    { id: 'governance', labelKey: 'projects.workspace.groups.governance', icon: ShieldCheck, body: nested(present([byId.get('charter'), byId.get('stakeholders'), raci, byId.get('risks')])) },
    { id: 'finance', labelKey: 'projects.workspace.groups.finance', icon: WalletCards, body: single(byId.get('finance')) },
    { id: 'updates', labelKey: 'projects.workspace.groups.updates', icon: Megaphone, body: single(updates) },
  ]
  const groups: ProjectWorkspaceGroup[] = candidates.flatMap(group => group.body ? [{ id: group.id, labelKey: group.labelKey, icon: group.icon, ...group.body }] : [])

  const currentPath = path ?? (isProjectRoot ? base : null)
  const isRoot = currentPath !== null && (currentPath.replace(/\/+$/, '') === base)
  const visibleTab = (tab: ProjectWorkspaceTabId | null): ProjectWorkspaceTabId | null => {
    if (!tab) return null
    const groupId = PROJECT_TAB_GROUP[tab]
    const group = groups.find(item => item.id === groupId)
    if (!group) return null
    return group.links.length ? (group.links.some(link => link.id === tab) ? tab : null) : tab
  }
  let activeTab = currentPath ? visibleTab(projectContextId(currentPath, taskQuery, true)) : null
  // The root page falls back to the summary when tasks are hidden.
  if (!activeTab && isRoot && projectContextId(currentPath!, taskQuery, true) !== 'settings') activeTab = visibleTab('summary')
  const activeGroup = activeTab ? PROJECT_TAB_GROUP[activeTab] : null
  return { groups, activeGroup, activeTab }
}
