import type { Component } from 'vue'
import { projectListReturnTo } from '../utils/projectNavigation'
import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'
import { CheckSquare, FolderKanban, Users, Settings, Wrench, Network, Files, ShieldCheck, UserCog, History, SlidersHorizontal, MessageCircle, ChartNoAxesCombined, CalendarDays, List, ClipboardList, CircleAlert, WalletCards, FileText, LayoutDashboard, Plus, UserRound, Repeat } from '@lucide/vue'
import { hasCapability, INTERNAL_NASQ_ACCESS, type AccessIdentity } from '../utils/accessPolicy'

export type NavGroup = 'chat' | 'projects' | 'meetings' | 'hr' | 'settings'
export type ShellModule = NavGroup | 'tasks' | 'reports' | 'vendor'
export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string; group?: NavGroup; module?: ShellModule; capability: string }
const items: NavItem[] = [
  { to: '/chat', labelKey: 'nav.chat', icon: MessageCircle, shortcut: 'c', group: 'chat', module: 'chat', capability: 'nasq.internal' },
  { to: '/projects/dashboard', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2', group: 'projects', module: 'projects', capability: 'pmo.projects.read' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1', group: 'projects', module: 'tasks', capability: 'pmo.tasks.read' },
  { to: '/meetings', labelKey: 'nav.meetings', icon: List, shortcut: 'm', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/calendar', labelKey: 'nav.meetingCalendar', icon: CalendarDays, shortcut: 'k', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/series', labelKey: 'nav.meetingSeries', icon: Repeat, shortcut: 'y', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/hr', labelKey: 'nav.employees', icon: Users, shortcut: '3', group: 'hr', module: 'hr', capability: 'hr.employees.read' },
  { to: '/hr/departments', labelKey: 'nav.departments', icon: Network, shortcut: '5', group: 'hr', module: 'hr', capability: 'hr.departments.read' },
  { to: '/hr/documents', labelKey: 'nav.documents', icon: Files, shortcut: '6', group: 'hr', module: 'hr', capability: 'hr.documents.read' },
  { to: '/settings/appearance', labelKey: 'settings.appearance.title', icon: SlidersHorizontal, shortcut: 'b', group: 'settings', module: 'settings', capability: 'nasq.internal' },
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

export const shellModules: ShellModuleDefinition[] = [
  { id: 'projects', labelKey: 'nav.projects', icon: FolderKanban, to: '/projects/dashboard' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: CheckSquare, to: '/tasks' },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, to: '/chat' },
  { id: 'meetings', labelKey: 'nav.meetings', icon: List, to: '/meetings' },
  { id: 'hr', labelKey: 'nav.humanResources', icon: Users, to: '/hr' },
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
  if (path === '/chat' || path.startsWith('/chat/')) return 'chat'
  if (path === '/meetings' || path.startsWith('/meetings/')) return 'meetings'
  if (path === '/hr' || path.startsWith('/hr/')) return 'hr'
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  if (path === '/reports' || path.startsWith('/reports/')) return 'projects'
  if (path === '/tasks' || path.startsWith('/tasks/') || path === '/archived-tasks') return 'tasks'
  if (path === '/projects' || path.startsWith('/projects/') || path === '/project-templates' || path.startsWith('/project-templates/')) return 'projects'
  if (path === '/account' || path.startsWith('/account/')) return 'settings'
  if (path === '/search' || path.startsWith('/search/')) return 'projects'
  if (path === '/notifications' || path.startsWith('/notifications/')) return null
  if (path === '/notification-digests' || path.startsWith('/notification-digests/')) return null
  if (path === '/odoo' || path.startsWith('/odoo/')) return 'vendor'
  return null
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

export function projectContextId(path: string, query: Record<string, unknown> = {}): ProjectContextId | null {
  const match = path.match(/^\/projects\/([^/]+)/)
  if (!match) return null
  const rest = path.replace(match[0], '').replace(/^\//, '')
  if (rest === 'settings') return 'settings'
  if (rest === 'charter') return 'charter'
  if (rest === 'finance' || rest.startsWith('finance/')) return 'finance'
  if (rest === 'stakeholders' || rest.startsWith('stakeholders/') || rest === 'raci') return 'stakeholders'
  if (rest === 'register' || rest.startsWith('register/')) return 'risks'
  if (rest === 'milestones' || rest.startsWith('milestones/')) return 'planning'
  if (rest === 'schedule' || rest.startsWith('schedule/') || rest === 'tasks' || rest.startsWith('tasks/')) return 'planning'
  if (query.tab === 'tasks' || query.tab === 'list' || query.tab === 'board' || query.tab === 'milestones') return 'planning'
  return 'summary'
}

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity): ShellContextLink[] {
  const links: ShellContextLink[] = {
    projects: [
      { id: 'project-dashboard', labelKey: 'nav.projectDashboard', icon: ChartNoAxesCombined, to: '/projects/dashboard', capability: 'pmo.projects.read' },
      { id: 'new-project', labelKey: 'nav.newProject', icon: Plus, to: '/projects/new', capability: 'pmo.projects.create', pinned: true },
      { id: 'projects', labelKey: 'nav.allProjects', icon: FolderKanban, to: '/projects', capability: 'pmo.projects.read' },
      { id: 'my-projects', labelKey: 'nav.myProjects', icon: UserRound, to: { path: '/projects', query: { mine: '1' } }, capability: 'pmo.projects.read' },
    ],
    tasks: [
      { id: 'tasks', labelKey: 'nav.tasks', icon: CheckSquare, to: '/tasks', capability: 'pmo.tasks.read' },
      { id: 'archived-tasks', labelKey: 'nav.archivedTasks', icon: ClipboardList, to: '/archived-tasks', capability: 'pmo.tasks.read' },
    ],
    reports: [
      { id: 'reports', labelKey: 'nav.reports', icon: ChartNoAxesCombined, to: '/reports', capability: 'pmo.projects.read' },
    ],
    chat: [
      { id: 'new-chat', labelKey: 'nav.newConversation', icon: Plus, to: '/chat/new', capability: INTERNAL_NASQ_ACCESS, pinned: true },
      { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, to: '/chat', capability: INTERNAL_NASQ_ACCESS },
    ],
    meetings: [
      { id: 'new-meeting', labelKey: 'nav.newMeeting', icon: Plus, to: '/meetings/new', capability: 'meetings.create', pinned: true },
      { id: 'meetings', labelKey: 'nav.meetings', icon: List, to: '/meetings', capability: 'meetings.read' },
      { id: 'meeting-calendar', labelKey: 'nav.meetingCalendar', icon: CalendarDays, to: '/meetings/calendar', capability: 'meetings.read' },
      { id: 'meeting-series', labelKey: 'nav.meetingSeries', icon: Repeat, to: '/meetings/series', capability: 'meetings.read' },
    ],
    hr: [
      { id: 'employees', labelKey: 'nav.employees', icon: Users, to: '/hr', capability: 'hr.employees.read' },
      { id: 'departments', labelKey: 'nav.departments', icon: Network, to: '/hr/departments', capability: 'hr.departments.read' },
      { id: 'documents', labelKey: 'nav.documents', icon: Files, to: '/hr/documents', capability: 'hr.documents.read' },
    ],
    settings: [
      { id: 'account', labelKey: 'nav.account', icon: UserCog, to: '/account', capability: INTERNAL_NASQ_ACCESS },
      { id: 'appearance', labelKey: 'settings.appearance.title', icon: SlidersHorizontal, to: '/settings/appearance', capability: INTERNAL_NASQ_ACCESS },
      { id: 'project-settings', labelKey: 'settings.projects.title', icon: Settings, to: '/settings/projects', capability: 'pmo.settings.manage' },
      { id: 'users', labelKey: 'nav.users', icon: UserCog, to: '/settings/users', capability: 'access.users.read' },
      { id: 'roles', labelKey: 'nav.roles', icon: ShieldCheck, to: '/settings/roles', capability: 'access.roles.read' },
      { id: 'access-log', labelKey: 'nav.accessLog', icon: History, to: '/settings/access-log', capability: 'access.audit.read' },
    ],
    vendor: [
      { id: 'console', labelKey: 'nav.console', icon: Wrench, to: '/odoo', capability: 'vendor' },
    ],
  }[module]
  return links.filter(link => hasCapability(identity, link.capability))
}

export function projectContextLinks(
  projectId: number,
  identity: AccessIdentity,
  activeProject: boolean,
  canManage: boolean,
  taskQuery: ShellQuery = {},
): ShellContextLink[] {
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
  if (['tasks', 'list', 'board', 'milestones'].includes(String(taskQuery.tab))) {
    remembered = Object.fromEntries(taskKeys.filter(key => typeof taskQuery[key] === 'string').map(key => [key, taskQuery[key]]))
    if (taskQuery.tab === 'board') remembered.view = 'board'
  }
  const listReturnTo = projectListReturnTo(taskQuery)
  const rootQuery = { taskContext: JSON.stringify(remembered), projectListReturnTo: listReturnTo, returnTo: listReturnTo }
  const projectReturnTo = `${base}?${new URLSearchParams(rootQuery)}`
  const contextQuery: ShellQuery = { ...rootQuery, returnTo: projectReturnTo }
  const links: ShellContextLink[] = [
    { id: 'summary', labelKey: 'nav.projectSummary', icon: LayoutDashboard, to: { path: base, query: rootQuery }, capability: 'pmo.projects.read' },
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
