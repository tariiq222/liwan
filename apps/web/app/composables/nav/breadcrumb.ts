// Relative imports: unit-tested directly under plain vitest.
import { activeShellModule, contextModuleFor } from './activeRoute'
import { allNavItems, LAUNCHER_MODULE, moduleContextLinks, shellModuleList } from './shellModules'
import { isNavPathActive } from '../../utils/accessPolicy'

import type { ShellCrumb } from '@webvue/ui/app/types/shell'

const normalize = (path: string) => path.replace(/\/+$/, '') || '/'
const target = (to: unknown): string => (typeof to === 'string' ? to : (to as { path?: string } | null)?.path ?? '')

/**
 * The header trail (Tasmim spec §5): rail module › active context section › page title.
 * Repeated labels and repeated targets collapse; the last crumb is the current page and
 * carries no link. A module links to its visible rail target; one the user cannot see keeps its
 * label without a link.
 */
export function shellBreadcrumb(input: { path: string; pageTitle?: string | null; t: (key: string) => string; rail: readonly { id: string; to: string }[] }): ShellCrumb[] {
  const crumbs: ShellCrumb[] = []
  const push = (crumb: ShellCrumb) => {
    const last = crumbs.at(-1)
    if (last && (last.label === crumb.label || (crumb.to && last.to === crumb.to))) return
    crumbs.push(crumb)
  }
  // True when the path is exactly the active section's own page.
  let sectionIsPage = false
  const module = activeShellModule(input.path)
  const definition = module ? [LAUNCHER_MODULE, ...shellModuleList()].find(item => item.id === module) : undefined
  if (definition) push({ label: input.t(definition.labelKey), to: definition === LAUNCHER_MODULE ? LAUNCHER_MODULE.to : input.rail.find(item => item.id === definition.id)?.to })
  const contextModule = contextModuleFor(module)
  if (contextModule) {
    const section = moduleContextLinks(contextModule, input.path)
      .filter(link => !link.pinned && isNavPathActive(input.path, target(link.to)))
      .sort((a, b) => target(b.to).length - target(a.to).length)[0]
    if (section) {
      const before = crumbs.length
      const sectionPath = target(section.to)
      // Sidebar labels may be abbreviated; the trail keeps the owning navigation label.
      const labelKey = allNavItems().find(item => normalize(item.to) === normalize(sectionPath))?.labelKey ?? section.labelKey
      push({ label: input.t(labelKey), to: sectionPath || undefined })
      sectionIsPage = crumbs.length > before && normalize(target(section.to)) === normalize(input.path)
    }
  }
  const title = input.pageTitle?.trim()
  // The page registers its heading after the server rendered this header, so the title is unknown on
  // the first paint. Drop a section's own crumb now instead of only after hydration.
  if (!title && sectionIsPage) return crumbs.slice(0, -1)
  // The page heading already names the current page. On a list page the last crumb is that same
  // label, so it is dropped and the trail ends at its parent (which keeps its link); a record page
  // keeps its title as the last crumb. A page with no parent shows no trail.
  if (title) {
    if (crumbs.at(-1)?.label === title) return crumbs.slice(0, -1)
    if (!crumbs.length) return []
    crumbs.push({ label: title })
  }
  if (crumbs.length) crumbs[crumbs.length - 1] = { label: crumbs.at(-1)!.label }
  return crumbs
}
