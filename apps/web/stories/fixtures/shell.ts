import { BrandingSchema, MeSchema } from '@liwan/contracts'
import type { ShellNavigationLink, ShellQuickItem } from '@liwan/ui/app/types/shell'

// A workspace user who sees every application and the administration module.
export const shellMe = MeSchema.parse({
  id: 7, name: 'سارة القحطاني', login: 'sara', email: 'sara@example.com', lang: 'ar_001', tz: 'Asia/Riyadh',
  role: 'admin', roles: [], access_policy_version: 1, company: { id: 1, name: 'شركة المثال' },
  capabilities: [
    'pmo.projects.read', 'pmo.projects.create', 'pmo.tasks.read', 'pmo.tasks.create', 'pmo.settings.manage',
    'meetings.read', 'meetings.create', 'hr.employees.read', 'hr.departments.read', 'documents.items.read',
    'access.users.read', 'access.roles.read', 'access.audit.read', 'settings.branding.manage',
  ],
  modules: ['liwan_pmo', 'liwan_meetings', 'liwan_hr', 'liwan_documents'],
  platform: {
    schema_version: 1, policy_revision: 1, state: 'active', valid_until: null, read_only: false,
    readable_features: ['pmo.enabled', 'meetings.enabled', 'documents.enabled', 'hr.enabled'],
    writable_features: ['pmo.enabled', 'meetings.enabled', 'documents.enabled', 'hr.enabled'],
  },
})

export const shellBranding = BrandingSchema.parse({
  name: 'شركة المثال',
  logo_url: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22%3E%3Crect width=%2224%22 height=%2224%22 rx=%226%22 fill=%22teal%22/%3E%3C/svg%3E',
  primary_color: '#14102a',
  font: 'IBM Plex Sans Arabic',
})

/** The same workspace user without any create or manage capability (palette Actions must be empty). */
export const readOnlyShellMe = { ...shellMe, capabilities: shellMe.capabilities.filter(key => !/\.(create|manage)$/.test(key)) }


/** The icon row under the organisation, as the shell hands it to the presentational sidebar: labels already translated. */
export const coreAppRows: ShellQuickItem[] = [
  { id: 'home', label: 'يومي', icon: 'i-lucide-house', to: '/', active: true },
  { id: 'ai', label: 'Liwan AI', icon: 'i-lucide-sparkles', to: '/ai', active: false },
  { id: 'tasks', label: 'مهامي', icon: 'i-lucide-check-square', to: '/my-tasks', active: false, count: 5 },
  { id: 'meetings', label: 'الاجتماعات', icon: 'i-lucide-calendar-days', to: '/meetings', active: false, count: 2 },
  { id: 'chat', label: 'المحادثات', icon: 'i-lucide-message-circle', to: '/chat', active: false },
  { id: 'documents', label: 'المستندات', icon: 'i-lucide-files', to: '/documents', active: false },
]
/** Sidebar rows as the shell hands them to the presentational sidebar: labels already translated. */
export const pinnedRows: ShellNavigationLink[] = [
  { id: 'crm', label: 'إدارة العملاء', icon: 'i-lucide-handshake', to: '/crm', active: false, app: 'crm', testId: 'navigation-app-crm' },
  { id: 'inbox', label: 'رسائل العملاء', icon: 'i-lucide-messages-square', to: '/inbox', active: false, app: 'inbox', count: 4, testId: 'navigation-app-inbox' },
  { id: 'projects', label: 'المشاريع', icon: 'i-lucide-folder-kanban', to: '/projects', active: false, app: 'projects', testId: 'navigation-app-projects' },
]
/** The sidebar footer: all applications and the settings. */
export const footerRows: ShellNavigationLink[] = [
  { id: 'apps', label: 'كل التطبيقات', icon: 'i-lucide-layout-grid', to: '/apps', active: false, testId: 'navigation-app-apps' },
  { id: 'settings', label: 'الإعدادات', icon: 'i-lucide-settings', to: '/settings', active: false, testId: 'navigation-app-settings' },
]
/** The links of one application (the projects settings of a long list): a create action, then a branch with children. */
export const appActionRows: ShellNavigationLink[] = [{ id: 'new-project', label: 'مشروع جديد', icon: 'i-lucide-plus', to: '/projects/new', active: false, primary: true, testId: 'quick-action-new-project' }]
export const appLinkRows: ShellNavigationLink[] = [
  { id: 'projects-all', label: 'كل المشاريع', icon: 'i-lucide-folder-kanban', to: '/projects', active: true, testId: 'context-link-projects' },
  {
    id: 'planning', label: 'التخطيط', icon: 'i-lucide-list-checks', to: '/tasks', active: false, testId: 'context-link-planning',
    children: [
      { id: 'planning-all', label: 'كل المهام', icon: 'i-lucide-list', to: '/tasks', active: false, testId: 'context-link-planning-all' },
      { id: 'planning-mine', label: 'المسندة إليّ', icon: 'i-lucide-user', to: '/tasks?assignee=me', active: false, count: 3, testId: 'context-link-planning-mine' },
    ],
  },
  { id: 'reports', label: 'التقارير', icon: 'i-lucide-chart-column', to: '/reports', active: false, testId: 'context-link-reports' },
]
/** The applications of the switcher grid. */
export const switcherApps = [
  { id: 'crm', label: 'إدارة العملاء', icon: 'i-lucide-handshake', to: '/crm' },
  { id: 'inbox', label: 'رسائل العملاء', icon: 'i-lucide-messages-square', to: '/inbox' },
  { id: 'tasks', label: 'مهامي', icon: 'i-lucide-check-square', to: '/my-tasks' },
  { id: 'meetings', label: 'الاجتماعات', icon: 'i-lucide-calendar-days', to: '/meetings' },
  { id: 'hr', label: 'الموارد البشرية', icon: 'i-lucide-users', to: '/hr' },
  { id: 'finance', label: 'المالية', icon: 'i-lucide-landmark', to: '/finance' },
]
