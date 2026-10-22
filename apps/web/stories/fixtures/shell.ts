import { BrandingSchema, MeSchema } from '@webvue/contracts'
import { contextLinksForModule, visibleShellModules, type ShellContextLink } from '../../app/composables/nav/shellModules'
import { contextLinkTestId, pinnableModules, railModel, sidebarModel, subListSections } from '../../app/composables/nav/sidebarModel'

// A workspace user who sees every application and the administration module.
export const shellMe = MeSchema.parse({
  id: 7, name: 'سارة القحطاني', login: 'sara', email: 'sara@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], access_policy_version: 1, company: { id: 1, name: 'شركة المثال' },
  capabilities: [
    'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.settings.manage',
    'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'documents.items.read',
    'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage',
  ],
  modules: ['webvue_pmo', 'webvue_meetings', 'webvue_hr', 'webvue_documents'],
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['pmo.enabled', 'meetings.enabled', 'documents.enabled', 'hr.enabled'],
    writable_features: ['pmo.enabled', 'meetings.enabled', 'documents.enabled', 'hr.enabled'],
  },
})

export const shellBranding = BrandingSchema.parse({
  name: 'شركة المثال',
  logo_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22teal%22/%3E%3C/svg%3E',
  primary_color: '#13234a',
  font: 'IBM Plex Sans Arabic',
})

const shellModules = visibleShellModules(shellMe)
/** The rail of a user who has pinned every application (the default). */
export const shellRail = railModel(shellModules, pinnableModules(shellModules).map(module => module.id))

/** The same workspace user without any create or manage capability (palette Actions must be empty). */
export const readOnlyShellMe = { ...shellMe, capabilities: shellMe.capabilities.filter(key => !/\.(create|manage)$/.test(key)) }

const projectLinks: ShellContextLink[] = contextLinksForModule('projects', shellMe, '/tasks').map(link => ({ ...link, active: link.id === 'tasks' }))
export const projectsSidebar = sidebarModel({ links: projectLinks, moduleLabelKey: 'nav.projects', path: '/tasks', panel: null, surface: 'desktop' })

// Story-only grouping: the first link stays in the fixed card, the others sit under a section heading and go to the sub-list card.
const settingsLinks: ShellContextLink[] = contextLinksForModule('settings', shellMe, '/settings/team/users')
  .map((link, index) => ({ ...link, active: link.id === 'users', section: index === 0 ? undefined : 'nav.systemAdministration' }))
const settingsModel = sidebarModel({ links: settingsLinks, moduleLabelKey: 'nav.settings', path: '/settings/team/users', panel: null, surface: 'desktop' })
export const sectionedSidebar = { createLinks: settingsModel.createLinks, sections: settingsModel.sections, showNav: settingsModel.showNav }
// The titled sections, rendered in their own card under the context sidebar (labels already translated).
export const subListFixture = subListSections(settingsModel.subSections, key => ({ 'nav.systemAdministration': 'إدارة النظام' }[key] ?? key.split('.').at(-1)!), contextLinkTestId)

/** The quick views card as the shell hands it over: labels already translated (the tasks list). */
export const quickViewItems = [
  { id: 'assigned', label: 'المسندة إليّ', icon: 'i-lucide-user', to: '/tasks?assignee=me', active: false },
  { id: 'today', label: 'اليوم', icon: 'i-lucide-sun', to: '/tasks?deadline=today', active: true },
  { id: 'week', label: 'هذا الأسبوع', icon: 'i-lucide-calendar-range', to: '/tasks?deadline=week', active: false },
  { id: 'overdue', label: 'المتأخرة', icon: 'i-lucide-circle-alert', to: '/tasks?deadline=overdue', active: false, count: 3 },
  { id: 'urgent', label: 'عاجلة', icon: 'i-lucide-flame', to: '/tasks?priority=3', active: false },
  { id: 'done', label: 'المنجزة', icon: 'i-lucide-circle-check', to: '/tasks?closed=1', active: false },
]
export const quickActionItems = [
  { id: 'new-task-pmo', label: 'مهمة جديدة', icon: 'i-lucide-plus', to: '/tasks/new', primary: true },
  { id: 'archived-tasks', label: 'المهام المؤرشفة', icon: 'i-lucide-archive', to: '/tasks?scope=archived' },
]

export const mobileDrawer = {
  modules: shellRail.drawer,
  activeId: 'projects',
  createLinks: projectsSidebar.createLinks,
  sections: projectsSidebar.sections,
  subSections: projectsSidebar.subSections,
  quickViews: quickViewItems,
  quickActions: quickActionItems,
}
