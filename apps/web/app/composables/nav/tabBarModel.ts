// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailItem, ShellTabItem } from '@liwan/ui/app/types/shell'

export interface TabBarInput {
  /** The destinations this user can reach (the permission-filtered rail). */
  rail: readonly ShellRailItem[]
  /** The open rail module (`home`, an application id, `settings`) or null on a page no application owns. */
  activeModule: string | null
  moreOpen: boolean
  translate: (key: string) => string
  moreLabel: string
}

/** The tabs that are their own destination, in bar order; «المزيد» follows them. */
const TAB_IDS = ['home', 'tasks', 'chat', 'ai'] as const

/**
 * The phone's bottom bar (owner decision): today, my tasks, conversations, the assistant and «المزيد». A tab shows only
 * when the user can reach its destination. «المزيد» opens the drawer, and is lit while it is open and on every page that
 * belongs to another application or to settings.
 */
export function tabBarItems(input: TabBarInput): ShellTabItem[] {
  const tabs = TAB_IDS.flatMap((id): ShellTabItem[] => {
    const entry = input.rail.find(item => item.id === id)
    return entry ? [{ id, label: input.translate(entry.shortLabelKey ?? entry.labelKey), icon: entry.icon, to: entry.to, active: !input.moreOpen && input.activeModule === id }] : []
  })
  const ownTab = (TAB_IDS as readonly string[]).includes(input.activeModule ?? '')
  const elsewhere = input.activeModule !== null && !ownTab
  return [...tabs, { id: 'more', label: input.moreLabel, icon: 'i-lucide-layout-grid', active: input.moreOpen || elsewhere, testId: 'mobile-navigation-trigger' }]
}
