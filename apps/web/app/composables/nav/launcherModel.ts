import type { AppIcon } from '../../modules/types'
import type { ShellModuleDefinition } from './shellModules'

/** One application card on the launcher page. */
export interface LauncherEntry {
  id: string
  labelKey: string
  icon: AppIcon
  /** The application's landing path, the one its rail entry opens. */
  to: string
  /** The application's start page. */
  overviewTo: string
  /** The utility slot (the assistant) is always in the rail, so it is never pinned or unpinned. */
  pinnable: boolean
  pinned: boolean
  /** Position among the pinned that are listed (0-based), or null; drives the order controls. */
  pinIndex: number | null
}

/** The applications among the shell modules: everything but the foundation entries (home and settings). */
export function reachableApplications(modules: readonly ShellModuleDefinition[]): ShellModuleDefinition[] {
  return modules.filter(module => module.id !== 'home' && module.id !== 'settings')
}

const rank = (item: LauncherEntry) => item.pinIndex ?? Number.MAX_SAFE_INTEGER

/**
 * Every application the user can reach (the modules the rail is built from, without the foundation entries): the pinned
 * ones first in pin order, then the others in manifest order. A non-empty `query` keeps the cards whose translated name has it.
 */
export function launcherEntries(
  modules: readonly ShellModuleDefinition[],
  pinned: readonly string[],
  query: string,
  translate: (key: string) => string,
): LauncherEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  const entry = (module: ShellModuleDefinition): LauncherEntry => ({
    id: module.id, labelKey: module.labelKey, icon: module.icon, to: module.to, overviewTo: `/apps/${module.id}`,
    pinnable: !module.utility, pinned: pinned.includes(module.id), pinIndex: pinned.includes(module.id) ? pinned.indexOf(module.id) : null,
  })
  const all = reachableApplications(modules).map(entry).sort((a, b) => rank(a) - rank(b))
  if (!needle) return all
  // The order controls act on the pinned cards that are on show, so a filtered list is counted afresh.
  let shownPins = 0
  return all
    .filter(item => translate(item.labelKey).toLocaleLowerCase().includes(needle))
    .map(item => (item.pinned ? { ...item, pinIndex: shownPins++ } : item))
}
