import { BrandingSchema, MeSchema } from '@webvue/contracts'
import { contextLinksForModule, visibleShellModules, type ShellContextLink } from '../../app/composables/nav/shellModules'
import { groupSections, railModel, sidebarModel } from '../../app/composables/nav/sidebarModel'

// A workspace user who sees every application and the administration module.
export const shellMe = MeSchema.parse({
  id: 7, name: 'سارة القحطاني', login: 'sara', email: 'sara@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], access_policy_version: 1, company: { id: 1, name: 'شركة المثال' },
  capabilities: [
    'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.settings.manage',
    'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'hr.documents.read',
    'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage',
  ],
  modules: ['webvue_pmo', 'webvue_meetings', 'webvue_hr'],
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['pmo.enabled', 'meetings.enabled', 'hr.enabled'],
    writable_features: ['pmo.enabled', 'meetings.enabled', 'hr.enabled'],
  },
})

export const shellBranding = BrandingSchema.parse({
  name: 'شركة المثال',
  logo_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22teal%22/%3E%3C/svg%3E',
  primary_color: '#13234a',
  font: 'IBM Plex Sans Arabic',
})

export const shellRail = railModel(visibleShellModules(shellMe))

/** The same workspace user without any create or manage capability (palette Actions must be empty). */
export const readOnlyShellMe = { ...shellMe, capabilities: shellMe.capabilities.filter(key => !/\.(create|manage)$/.test(key)) }

const projectLinks: ShellContextLink[] = contextLinksForModule('projects', shellMe, '/tasks').map(link => ({ ...link, active: link.id === 'tasks' }))
export const projectsSidebar = sidebarModel({ links: projectLinks, moduleLabelKey: 'nav.projects', path: '/tasks', panel: null, surface: 'desktop' })

// Story-only grouping to show section headings; no module ships sections yet (DESIGN.md §3).
const settingsLinks: ShellContextLink[] = contextLinksForModule('settings', shellMe, '/settings/users')
  .map(link => ({ ...link, active: link.id === 'users', section: link.id === 'branding' ? 'settings.branding.title' : 'nav.systemAdministration' }))
export const sectionedSidebar = { createLinks: [] as ShellContextLink[], sections: groupSections(settingsLinks), showNav: true }

export const mobileDrawer = {
  modules: shellRail.all,
  activeId: 'projects',
  createLinks: projectsSidebar.createLinks,
  sections: projectsSidebar.sections,
}
