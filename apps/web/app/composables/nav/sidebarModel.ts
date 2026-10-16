// Relative imports: this module is unit-tested directly under plain vitest.
import type { ShellRailItem } from '@nasq/ui/app/types/shell'
import { hidePinnedNewProject, type ShellContextLink, type ShellModuleDefinition } from './shellModules'

/** A run of context links under one optional section heading (a locale key). */
export interface ShellContextSection { id: string; titleKey: string | null; links: ShellContextLink[] }
export interface ShellSidebarModel { createLinks: ShellContextLink[]; sections: ShellContextSection[]; showNav: boolean }

const UTILITY_MODULES: ReadonlySet<string> = new Set(['settings'])

/** Rail entries in rail order; settings sits in the utility slot at the bottom. */
export function railModel(modules: readonly ShellModuleDefinition[]): { all: ShellRailItem[]; primary: ShellRailItem[]; utility: ShellRailItem[] } {
  const all = modules.map(module => ({ id: module.id, labelKey: module.labelKey, icon: module.icon, to: module.to, external: false }))
  return { all, primary: all.filter(item => !UTILITY_MODULES.has(item.id)), utility: all.filter(item => UTILITY_MODULES.has(item.id)) }
}

/** Consecutive links that share a `section` key form one section, in manifest order. */
export function groupSections(links: readonly ShellContextLink[]): ShellContextSection[] {
  const sections: ShellContextSection[] = []
  for (const link of links) {
    const titleKey = link.section ?? null
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
  const showNav = navigation.length > 0 && (input.surface === 'mobile' || !onlyRepeatsHeading)
  return { createLinks, sections: groupSections(navigation), showNav }
}

const LEGACY_TEST_IDS: Readonly<Record<string, string>> = {
  users: 'sidebar-settings',
  'project-settings': 'settings-projects-tab',
  branding: 'settings-branding-tab',
}

/** Playwright hook of a context link; three keep the ids older specs use. */
export function contextLinkTestId(id: string): string {
  return LEGACY_TEST_IDS[id] ?? `context-link-${id}`
}
