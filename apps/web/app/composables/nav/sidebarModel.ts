// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailGroups, ShellRailItem } from '@liwan/ui/app/types/shell'
import { hidePinnedNewProject, LAUNCHER_MODULE, type ShellContextLink, type ShellModuleDefinition } from './shellModules'

/** A run of context links under one optional section heading (a locale key). */
export interface ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }
const SETTINGS_MODULE_ID = 'settings'

const HOME_MODULE_ID = 'home'
const toRailItem = (module: ShellModuleDefinition): ShellRailItem =>
  ({ id: module.id, labelKey: module.labelKey, shortLabelKey: module.shortLabelKey, icon: module.icon, to: module.to })

/** `first` and `last` are the fixed base-system entries around the pinnable `applications`. */
export interface ShellRailModel extends ShellRailGroups {
  first: ShellRailItem[]
  last: ShellRailItem[]
  all: ShellRailItem[]
}

/**
 * Rail order (owner decision 2026-11-06): the assistant and «يومي» fixed at the top, then the `first` fixed entries
 * (meetings), the pinnable applications in manifest order, the `last` fixed entries (documents), then settings.
 * The sidebar and the phone drawer list these destinations: the pinned ones in global mode, the open one in app mode.
 */
export function railModel(modules: readonly ShellModuleDefinition[]): ShellRailModel {
  const home = modules.find(module => module.id === HOME_MODULE_ID)
  const slot = (fixed: ShellModuleDefinition['fixed']) => modules.filter(module => module.fixed === fixed).map(toRailItem)
  // «يومي» opens the page that holds the day and the applications.
  const top = [...slot('top'), toRailItem(home ?? LAUNCHER_MODULE)]
  const first = slot('first')
  const applications = modules.filter(module => !module.fixed && module.id !== HOME_MODULE_ID && module.id !== SETTINGS_MODULE_ID).map(toRailItem)
  const last = slot('last')
  const utility = modules.filter(module => module.id === SETTINGS_MODULE_ID).map(toRailItem)
  const all = [...top, ...first, ...applications, ...last, ...utility]
  return { top, first, applications, last, utility, all }
}

/** The create links the sidebar lists first for the open page: the pinned ones, minus «مشروع جديد» where it would repeat the page. */
export function pinnedCreateLinks(links: readonly ShellContextLink[], path: string): ShellContextLink[] {
  return links.filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(path)))
}

/** Consecutive links that share a heading key (`section` by default) form one section, in manifest order. */
export function groupSections(links: readonly ShellContextLink[], headingOf: (link: ShellContextLink) => string | null = link => link.section ?? null): ShellContextSection[] {
  const sections: ShellContextSection[] = []
  for (const link of links) {
    const titleKey = headingOf(link)
    const last = sections.at(-1)
    if (last && last.titleKey === titleKey) last.links.push(link)
    else sections.push({ id: `${titleKey ?? 'section'}-${sections.length}`, titleKey, links: [link] })
  }
  return sections
}

const LEGACY_TEST_IDS: Readonly<Record<string, string>> = {
  users: 'sidebar-settings',
  'settings-projects': 'settings-projects-tab',
  branding: 'settings-branding-tab',
}

/** Playwright hook of a context link; three keep the ids older specs use. */
export function contextLinkTestId(id: string): string {
  return LEGACY_TEST_IDS[id] ?? `context-link-${id}`
}
