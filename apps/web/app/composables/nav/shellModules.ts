import type { RouteLocationRaw } from 'vue-router'
// Relative imports: the `@/` alias does not resolve for value imports under a
// plain `vitest run`, and this module is unit-tested directly.
import { hasCapability, INTERNAL_NASQ_ACCESS, type AccessIdentity } from '../../utils/accessPolicy'
import { normalizedPath } from './activeRoute'
// NavIcon has one owner (nav/projectSections.ts); import for internal use only,
// never re-export, or the auto-import namespace collision just moves here.
import type { NavIcon } from './projectSections'

// UIcon resolves these names from the local Lucide Iconify collection. Keep
// the names in this shared model so every shell consumer renders the same icon
// without importing Vue component implementations into navigation data.
const CheckSquare = 'i-lucide-check-square'
const FolderKanban = 'i-lucide-folder-kanban'
const Users = 'i-lucide-users'
const Settings = 'i-lucide-settings'
const Wrench = 'i-lucide-wrench'
const Network = 'i-lucide-network'
const Files = 'i-lucide-files'
const ShieldCheck = 'i-lucide-shield-check'
const UserCog = 'i-lucide-user-cog'
const History = 'i-lucide-history'
const Palette = 'i-lucide-palette'
const MessageCircle = 'i-lucide-message-circle'
const ChartNoAxesCombined = 'i-lucide-chart-no-axes-combined'
const CalendarDays = 'i-lucide-calendar-days'
const LayoutTemplate = 'i-lucide-layout-template'
const House = 'i-lucide-house'
const Plus = 'i-lucide-plus'
const Repeat = 'i-lucide-repeat'

export type NavGroup = 'chat' | 'projects' | 'meetings' | 'hr' | 'settings'
/** Rail modules. `home` is the projects dashboard; tasks, templates, reports and search live under `projects`. */
export type ShellModule = NavGroup | 'home' | 'vendor'
export interface NavItem { to: string; labelKey: string; icon: NavIcon; shortcut: string; group?: NavGroup; module?: ShellModule; capability: string }
const items: NavItem[] = [
  { to: '/projects/dashboard', labelKey: 'nav.home', icon: House, shortcut: 'h', group: 'projects', module: 'home', capability: 'pmo.projects.read' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2', group: 'projects', module: 'projects', capability: 'pmo.projects.read' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1', group: 'projects', module: 'projects', capability: 'pmo.tasks.read' },
  { to: '/project-templates', labelKey: 'nav.projectTemplates', icon: LayoutTemplate, shortcut: 't', group: 'projects', module: 'projects', capability: 'pmo.projects.read' },
  { to: '/projects/settings', labelKey: 'settings.projects.title', icon: Settings, shortcut: '4', group: 'projects', module: 'projects', capability: 'pmo.settings.manage' },
  { to: '/meetings', labelKey: 'nav.meetings', icon: CalendarDays, shortcut: 'm', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/calendar', labelKey: 'nav.meetingCalendar', icon: CalendarDays, shortcut: 'k', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/meetings/series', labelKey: 'nav.meetingSeries', icon: Repeat, shortcut: 'y', group: 'meetings', module: 'meetings', capability: 'meetings.read' },
  { to: '/chat', labelKey: 'nav.chat', icon: MessageCircle, shortcut: 'c', group: 'chat', module: 'chat', capability: 'nasq.internal' },
  { to: '/hr', labelKey: 'nav.employees', icon: Users, shortcut: '3', group: 'hr', module: 'hr', capability: 'hr.employees.read' },
  { to: '/hr/departments', labelKey: 'nav.departments', icon: Network, shortcut: '5', group: 'hr', module: 'hr', capability: 'hr.departments.read' },
  { to: '/hr/documents', labelKey: 'nav.documents', icon: Files, shortcut: '6', group: 'hr', module: 'hr', capability: 'hr.documents.read' },
  { to: '/settings/branding', labelKey: 'settings.branding.title', icon: Palette, shortcut: 'g', group: 'settings', module: 'settings', capability: 'settings.branding.manage' },
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
  icon: NavIcon
  to: string
}

/** Rail order (user decision 2026-09-11); settings and the vendor console stay in the utility slot. */
export const shellModules: ShellModuleDefinition[] = [
  { id: 'home', labelKey: 'nav.home', icon: House, to: '/projects/dashboard' },
  { id: 'projects', labelKey: 'nav.projects', icon: FolderKanban, to: '/projects' },
  { id: 'meetings', labelKey: 'nav.meetings', icon: CalendarDays, to: '/meetings' },
  { id: 'chat', labelKey: 'nav.chat', icon: MessageCircle, to: '/chat' },
  { id: 'hr', labelKey: 'nav.organization', icon: Users, to: '/hr' },
  // Settings is administration only: account and appearance live in the header.
  { id: 'settings', labelKey: 'nav.settings', icon: Settings, to: '/settings/users' },
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

export interface ShellContextLink {
  id: string
  labelKey: string
  icon: NavIcon
  to: RouteLocationRaw
  capability: string
  active?: boolean
  pinned?: boolean
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
  const target = normalizedPath(path)
  return target === '/projects' || target === '/projects/new' || /^\/projects\/[1-9]\d*(?:\/|$)/.test(target)
}

/** Projects sidebar: shown for `home` and `projects`, including inside a project (2026-09-11). */
const projectsContextLinks: ShellContextLink[] = [
  { id: 'new-project', labelKey: 'nav.newProject', icon: Plus, to: '/projects/new', capability: 'pmo.projects.create', pinned: true },
  { id: 'project-dashboard', labelKey: 'nav.projectDashboard', icon: ChartNoAxesCombined, to: '/projects/dashboard', capability: 'pmo.projects.read' },
  { id: 'projects', labelKey: 'nav.allProjects', icon: FolderKanban, to: '/projects', capability: 'pmo.projects.read' },
  { id: 'tasks', labelKey: 'nav.tasks', icon: CheckSquare, to: '/tasks', capability: 'pmo.tasks.read' },
  { id: 'project-templates', labelKey: 'nav.projectTemplates', icon: LayoutTemplate, to: '/project-templates', capability: 'pmo.projects.read' },
  // Project settings close the projects sidebar (user decision 2026-09-16); they are not a settings-module page.
  { id: 'project-settings', labelKey: 'settings.projects.title', icon: Settings, to: '/projects/settings', capability: 'pmo.settings.manage' },
]

export function contextLinksForModule(module: ShellModule, identity: AccessIdentity, path?: string): ShellContextLink[] {
  const linksByModule: Record<ShellModule, ShellContextLink[]> = {
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
      { id: 'users', labelKey: 'nav.users', icon: UserCog, to: '/settings/users', capability: 'access.users.read' },
      { id: 'roles', labelKey: 'nav.roles', icon: ShieldCheck, to: '/settings/roles', capability: 'access.roles.read' },
      { id: 'access-log', labelKey: 'nav.accessLog', icon: History, to: '/settings/access-log', capability: 'access.audit.read' },
      { id: 'branding', labelKey: 'settings.branding.title', icon: Palette, to: '/settings/branding', capability: 'settings.branding.manage' },
    ],
    vendor: [
      { id: 'console', labelKey: 'nav.console', icon: Wrench, to: '/odoo', capability: 'vendor' },
    ],
  }
  const links = linksByModule[module]
  return links.filter(link => hasCapability(identity, link.capability))
}
