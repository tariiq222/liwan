// Relative imports: unit-tested directly under plain vitest.
import { activeShellModule, contextModuleFor } from './activeRoute'
import { moduleContextLinks, shellModuleList } from './shellModules'
import { isNavPathActive } from '../../utils/accessPolicy'

export interface ShellCrumb { label: string; to?: string }

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
  const module = activeShellModule(input.path)
  const definition = module ? shellModuleList().find(item => item.id === module) : undefined
  if (definition) push({ label: input.t(definition.labelKey), to: input.rail.find(item => item.id === definition.id)?.to })
  const contextModule = contextModuleFor(module)
  if (contextModule) {
    const section = moduleContextLinks(contextModule, input.path)
      .filter(link => !link.pinned && isNavPathActive(input.path, target(link.to)))
      .sort((a, b) => target(b.to).length - target(a.to).length)[0]
    if (section) push({ label: input.t(section.labelKey), to: target(section.to) || undefined })
  }
  const title = input.pageTitle?.trim()
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
