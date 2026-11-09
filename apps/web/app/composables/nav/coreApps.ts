// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellQuickItem, ShellRailItem } from '@liwan/ui/app/types/shell'

export interface CoreAppsInput {
  /** «يومي» and the free base-system applications this user may reach (the permission- and feature-filtered rail). */
  core: readonly ShellRailItem[]
  /** The open rail module (`home`, an application id, `settings`) or null on a page no application owns. */
  activeModule: string | null
  /** The badge number of the applications that have one, by rail id (null or absent: no badge). */
  badges: Readonly<Record<string, number | null | undefined>>
  translate: (key: string) => string
}

/** The icon row under the organisation: one link to the full page of each core application, lit while it is open. */
export function coreAppItems(input: CoreAppsInput): ShellQuickItem[] {
  return input.core.map((item): ShellQuickItem => {
    const count = input.badges[item.id]
    return {
      id: item.id, label: input.translate(item.labelKey), icon: item.icon, to: item.to,
      active: input.activeModule === item.id, ...(count ? { count } : {}),
    }
  })
}
