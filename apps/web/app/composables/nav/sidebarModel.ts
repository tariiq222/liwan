// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailGroups, ShellRailItem, ShellSubListSection } from '@liwan/ui/app/types/shell'
import { hidePinnedNewProject, LAUNCHER_MODULE, type ShellContextLink, type ShellModuleDefinition } from './shellModules'

/** A run of context links under one optional section heading (a locale key). */
export interface ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }
/**
 * `sections` are the untitled runs (the fixed links of the first card); `subSections` are the titled runs, the open
 * section's sub-list, which the shell renders in its own card below the first one.
 */
export interface ShellSidebarModel { createLinks: ShellContextLink[]; sections: ShellContextSection[]; subSections: ShellContextSection[]; showNav: boolean }

const SETTINGS_MODULE_ID = 'settings'

const HOME_MODULE_ID = 'home'
const toRailItem = (module: ShellModuleDefinition): ShellRailItem =>
  ({ id: module.id, labelKey: module.labelKey, shortLabelKey: module.shortLabelKey, icon: module.icon, to: module.to, ...(module.accent ? { accent: true } : {}) })

/** `first` and `last` are the fixed base-system entries around the pinnable `applications`. */
export interface ShellRailModel extends ShellRailGroups {
  first: ShellRailItem[]
  last: ShellRailItem[]
  all: ShellRailItem[]
  drawer: ShellRailItem[]
}

/**
 * Rail order (owner decision 2026-11-06): the assistant and «يومي» fixed at the top, then the `first` fixed entries
 * (meetings), the pinnable applications in manifest order, the `last` fixed entries (documents), then settings.
 * The mobile drawer shows the same destinations.
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
  return { top, first, applications, last, utility, all, drawer: all }
}

export function railActiveId(rail: Pick<ShellRailModel, 'top' | 'applications' | 'utility'>, activeId: string | null): string | null {
  if (activeId === null) return null
  // An area outside the rail lights «يومي», the last top entry (the fixed top entries come before it).
  return [...rail.top, ...rail.applications, ...rail.utility].some(item => item.id === activeId) ? activeId : rail.top.at(-1)?.id ?? null
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

/**
 * What the context sidebar (desktop) or the drawer (mobile) lists for the current module:
 * pinned create actions first, then navigation. A module with a sidebar panel shows no create
 * action beside it on desktop, and while the panel is expanded its links give way to the panel.
 */
export function sidebarModel(input: {
  links: readonly ShellContextLink[]
  moduleLabelKey: string | null
  path: string
  /** Set when the module's panel renders (desktop only). */
  panel: { expanded: boolean } | null
  surface: 'desktop' | 'mobile'
}): ShellSidebarModel {
  const ordered = [...input.links.filter(link => link.pinned), ...input.links.filter(link => !link.pinned)]
  const desktopPanel = input.surface === 'desktop' && input.panel !== null
  const visible = desktopPanel && input.panel!.expanded ? ordered.filter(link => link.pinned) : ordered
  const createLinks = desktopPanel
    ? []
    : visible.filter(link => link.pinned && !(link.id === 'new-project' && hidePinnedNewProject(input.path)))
  const navigation = visible.filter(link => !link.pinned)
  const onlyRepeatsHeading = createLinks.length === 0 && navigation.length === 1 && navigation[0]!.labelKey === input.moduleLabelKey
  const listed = navigation.length > 0 && (input.surface === 'mobile' || !onlyRepeatsHeading) ? navigation : []
  // Links with a `section` form the sub-list card; the rest are the first card, where `group` heads a run of links.
  const sections = groupSections(listed.filter(link => !link.section), link => link.group ?? null)
  return { createLinks, sections, subSections: groupSections(listed.filter(link => link.section)), showNav: sections.length > 0 }
}

/** The sub-list card's input: each titled section with translated labels and the test id of every row. */
export function subListSections(sections: readonly ShellContextSection[], translate: (key: string) => string, testIdOf: (id: string) => string): ShellSubListSection[] {
  return sections.map(section => ({
    id: section.id,
    title: translate(section.titleKey!),
    items: section.links.map(link => ({ id: link.id, label: translate(link.labelKey), icon: link.icon, to: link.to, active: link.active, testId: testIdOf(link.id) })),
  }))
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
