import type { Component } from 'vue'
import { Sun, CheckSquare, FolderKanban, Users, BarChart3, Settings } from 'lucide-vue-next'
import type { Role } from '@nasq/contracts'

export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string }

const base: NavItem[] = [
  { to: '/', labelKey: 'nav.today', icon: Sun, shortcut: '1' },
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '2' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '3' },
  { to: '/hr', labelKey: 'nav.people', icon: Users, shortcut: '4' },
  { to: '/reports', labelKey: 'nav.reports', icon: BarChart3, shortcut: '5' },
]
// Vendor console. The customer_admin Settings section arrives in phase 3.
const vendorConsole: NavItem = { to: '/odoo', labelKey: 'nav.console', icon: Settings, shortcut: 's' }

export function useNav(role: Role | null | undefined): NavItem[] {
  return role === 'vendor' ? [...base, vendorConsole] : base
}
