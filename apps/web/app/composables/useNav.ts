import type { Component } from 'vue'
import { Sun, CheckSquare, FolderKanban, Users, BarChart3, Settings, Wrench } from 'lucide-vue-next'
import type { Role } from '@nasq/contracts'

export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string }

const base: NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: Sun, shortcut: '1' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '2' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '3' },
  { to: '/hr', labelKey: 'nav.people', icon: Users, shortcut: '4' },
  { to: '/reports', labelKey: 'nav.reports', icon: BarChart3, shortcut: '5' },
]
// Phase 3a: customer_admin and vendor both get an in-app Settings section for
// project administration (default stages, who can create projects).
const settings: NavItem = { to: '/settings/projects', labelKey: 'nav.settings', icon: Settings, shortcut: '6' }
// Vendor console, kept distinct from Settings (different icon) and last in the list.
const vendorConsole: NavItem = { to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's' }

export function useNav(role: Role | null | undefined): NavItem[] {
  if (role === 'vendor') return [...base, settings, vendorConsole]
  if (role === 'admin') return [...base, settings]
  return base
}
