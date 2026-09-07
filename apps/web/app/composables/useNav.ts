import type { Component } from 'vue'
import { CheckSquare, FolderKanban, Users, Settings, Wrench, Network, Files, ShieldCheck, UserCog, History, SlidersHorizontal, MessageCircle } from '@lucide/vue'
import { hasCapability, type AccessIdentity } from '../utils/accessPolicy'

export type NavGroup = 'chat' | 'projects' | 'hr' | 'settings'
export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string; group?: NavGroup; capability: string }
const items: NavItem[] = [
  { to: '/chat', labelKey: 'nav.chat', icon: MessageCircle, shortcut: 'c', group: 'chat', capability: 'nasq.internal' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2', group: 'projects', capability: 'pmo.projects.read' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1', group: 'projects', capability: 'pmo.tasks.read' },
  { to: '/hr', labelKey: 'nav.employees', icon: Users, shortcut: '3', group: 'hr', capability: 'hr.employees.read' },
  { to: '/hr/departments', labelKey: 'nav.departments', icon: Network, shortcut: '5', group: 'hr', capability: 'hr.departments.read' },
  { to: '/hr/documents', labelKey: 'nav.documents', icon: Files, shortcut: '6', group: 'hr', capability: 'hr.documents.read' },
  { to: '/settings/appearance', labelKey: 'settings.appearance.title', icon: SlidersHorizontal, shortcut: 'b', group: 'settings', capability: 'nasq.internal' },
  { to: '/settings/projects', labelKey: 'settings.projects.title', icon: Settings, shortcut: '4', group: 'settings', capability: 'pmo.settings.manage' },
  { to: '/settings/users', labelKey: 'nav.users', icon: UserCog, shortcut: '7', group: 'settings', capability: 'access.users.read' },
  { to: '/settings/roles', labelKey: 'nav.roles', icon: ShieldCheck, shortcut: '8', group: 'settings', capability: 'access.roles.read' },
  { to: '/settings/access-log', labelKey: 'nav.accessLog', icon: History, shortcut: '9', group: 'settings', capability: 'access.audit.read' },
]
export function useNav(identity: AccessIdentity): NavItem[] {
  const visible = items.filter(item => (
    item.capability === 'nasq.internal'
      ? Array.isArray(identity?.capabilities)
      : hasCapability(identity, item.capability)
  ))
  if (identity?.role === 'vendor' && identity.capabilities?.length) visible.push({ to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's', capability: 'vendor' })
  return visible
}
