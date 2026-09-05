import type { Component } from 'vue'
import { CheckSquare, FolderKanban, Users, Settings, Wrench } from 'lucide-vue-next'
import type { Role } from '@nasq/contracts'

export interface NavItem { to: string; labelKey: string; icon: Component; shortcut: string }

const base: NavItem[] = [
  { to: '/tasks', labelKey: 'nav.tasks', icon: CheckSquare, shortcut: '1' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderKanban, shortcut: '2' },
  { to: '/hr', labelKey: 'nav.people', icon: Users, shortcut: '3' },
]
// Phase 3a: customer_admin and vendor both get an in-app Settings section for
// project administration (default stages, who can create projects).
const settings: NavItem = { to: '/settings/projects', labelKey: 'nav.settings', icon: Settings, shortcut: '4' }
// Vendor console, kept distinct from Settings (different icon) and last in the list.
const vendorConsole: NavItem = { to: '/odoo', labelKey: 'nav.console', icon: Wrench, shortcut: 's' }

export function useNav(role: Role | null | undefined): NavItem[] {
  if (role === 'vendor') return [...base, settings, vendorConsole]
  if (role === 'admin') return [...base, settings]
  return base
}
