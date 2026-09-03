import type { Component } from 'vue'
import { Sun, CheckSquare, FolderKanban, Users, BarChart3, Settings } from 'lucide-vue-next'
import type { Role } from '@nasq/contracts'

export interface NavItem { to: string; label: string; icon: Component; shortcut: string }

const base: NavItem[] = [
  { to: '/', label: 'اليوم', icon: Sun, shortcut: '1' },
  { to: '/tasks', label: 'مهامي', icon: CheckSquare, shortcut: '2' },
  { to: '/projects', label: 'المشاريع', icon: FolderKanban, shortcut: '3' },
  { to: '/people', label: 'الأشخاص', icon: Users, shortcut: '4' },
  { to: '/reports', label: 'التقارير', icon: BarChart3, shortcut: '5' },
]
// Until phase 3 ships the in-app Settings section, admins open the vendor console.
const settings: NavItem = { to: '/odoo', label: 'الإعدادات', icon: Settings, shortcut: 's' }

export function useNav(role: Role | null | undefined): NavItem[] {
  return role === 'admin' || role === 'vendor' ? [...base, settings] : base
}
