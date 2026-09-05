import type { Component } from 'vue'
import { CheckSquare, FolderKanban, Users, Settings, Wrench, Network, Files, ShieldCheck, UserCog, History, Palette } from 'lucide-vue-next'
import { hasCapability, type AccessIdentity } from '../utils/accessPolicy'

export type NavGroup = 'projects' | 'hr' | 'admin'
export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string; group?: NavGroup; capability: string }
const items: NavItem[] = [
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2', group: 'projects', capability: 'pmo.projects.read' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1', group: 'projects', capability: 'pmo.tasks.read' },
  { to: '/settings/projects', labelKey: 'nav.projectSettings', icon: Settings, shortcut: '4', group: 'projects', capability: 'pmo.settings.manage' },
  { to: '/hr', labelKey: 'nav.employees', icon: Users, shortcut: '3', group: 'hr', capability: 'hr.employees.read' },
  { to: '/hr/departments', labelKey: 'nav.departments', icon: Network, shortcut: '5', group: 'hr', capability: 'hr.departments.read' },
  { to: '/hr/documents', labelKey: 'nav.documents', icon: Files, shortcut: '6', group: 'hr', capability: 'hr.documents.read' },
  { to: '/settings/users', labelKey: 'nav.users', icon: UserCog, shortcut: '7', group: 'admin', capability: 'access.users.read' },
  { to: '/settings/roles', labelKey: 'nav.roles', icon: ShieldCheck, shortcut: '8', group: 'admin', capability: 'access.roles.read' },
  { to: '/settings/access-log', labelKey: 'nav.accessLog', icon: History, shortcut: '9', group: 'admin', capability: 'access.audit.read' },
  { to: '/settings/branding', labelKey: 'nav.branding', icon: Palette, shortcut: 'b', group: 'admin', capability: 'settings.branding.manage' },
]
export function useNav(identity: AccessIdentity): NavItem[] {
  const visible = items.filter(item => hasCapability(identity, item.capability))
  if (identity?.role === 'vendor' && identity.capabilities?.length) visible.push({ to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's', capability: 'vendor' })
  return visible
}
