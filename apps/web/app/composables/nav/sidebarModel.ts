// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailItem } from '@liwan/ui/app/types/shell'
import { hidePinnedNewProject, LAUNCHER_MODULE, type ShellContextLink, type ShellModuleDefinition } from './shellModules'

/** A run of context links under one optional section heading (a locale key). */
export interface ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }
const SETTINGS_MODULE_ID = 'settings'

const HOME_MODULE_ID = 'home'
const toRailItem = (module: ShellModuleDefinition): ShellRailItem =>
  ({ id: module.id, labelKey: module.labelKey, shortLabelKey: module.shortLabelKey, icon: module.icon, to: module.to })

/** `core` is «يومي» and the free base-system applications (the icon row under the organisation); `applications` are the pinnable ones. */
export interface ShellRailModel {
  core: ShellRailItem[]
  applications: ShellRailItem[]
  utility: ShellRailItem[]
  all: ShellRailItem[]
}

/**
 * Rail order (owner decision 2026-11-08): «يومي» then the free base-system applications by their manifest `core`
 * position (the icon row under the organisation), the pinnable applications in manifest order, then settings.
 * The sidebar and the phone drawer list these destinations: the core row always, the pinned ones in global mode,
 * the open one in app mode.
 */
export function railModel(modules: readonly ShellModuleDefinition[]): ShellRailModel {
  const home = modules.find(module => module.id === HOME_MODULE_ID)
  // «يومي» opens the page that holds the day and the applications.
  const core = [toRailItem(home ?? LAUNCHER_MODULE), ...modules.filter(module => module.core !== undefined).sort((a, b) => a.core! - b.core!).map(toRailItem)]
  const applications = modules.filter(module => module.core === undefined && module.id !== HOME_MODULE_ID && module.id !== SETTINGS_MODULE_ID).map(toRailItem)
  const utility = modules.filter(module => module.id === SETTINGS_MODULE_ID).map(toRailItem)
  return { core, applications, utility, all: [...core, ...applications, ...utility] }
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
