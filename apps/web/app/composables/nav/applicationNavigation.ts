import type { ShellNavigationItem, ShellNavigationLink, ShellQuickItem } from '@liwan/ui/app/types/shell'
import { canReach, canReachPath, type AccessIdentity } from '../../utils/accessPolicy'
import { sidebarPanelFor } from '../../modules/surfaces'
import { createLinkTo, type CreateActionRoute } from './createActions'
import { contextLinksForModule, moduleContextLinks, visibleShellModules, type ShellContextLink } from './shellModules'
import { contextLinkTestId, groupSections, railModel } from './sidebarModel'
import { quickViewsModel } from './quickViewsModel'
import { normalizedPath } from '../../utils/routePath'

export interface ApplicationNavigationInput {
  identity: AccessIdentity
  route: CreateActionRoute
  activeId: string | null
  contextLinks: readonly ShellContextLink[]
  translate: (key: string, values?: Record<string, string>) => string
}

function targetPath(to: ShellQuickItem['to']) {
  return typeof to === 'string' ? to.split(/[?#]/, 1)[0] : 'path' in to ? to.path : undefined
}
function landingTarget(to: ShellQuickItem['to'], path: string): ShellQuickItem['to'] {
  const view = typeof to !== 'string' && 'query' in to ? to.query?.view : undefined
  return view === undefined ? path : { path, query: { view } }
}
const targetKey = (to: ShellQuickItem['to']) => typeof to === 'string' ? to : JSON.stringify(to)
const hasHash = (to: ShellQuickItem['to']) => typeof to === 'string' ? to.includes('#') : 'hash' in to && !!to.hash
const selected = (row: ShellNavigationLink): boolean => !!row.active || !!row.children?.some(selected)

export function applicationNavigation(input: ApplicationNavigationInput): ShellNavigationItem[] {
  const t = input.translate
  const personal = input.route.path === '/account' || input.route.path.startsWith('/account/')
  const activeId = personal ? 'account' : input.activeId
  const rail = railModel(visibleShellModules(input.identity))
  const entries = [...rail.top, ...rail.applications,
    ...(personal ? [{ id: 'account', labelKey: 'nav.account', icon: 'i-lucide-user-round', to: '/account' }] : []),
    ...rail.utility]

  return entries.map(entry => {
    const active = entry.id === activeId
    const item: ShellNavigationItem = { id: entry.id, label: t(entry.labelKey), icon: entry.icon, to: entry.to, active, sections: [], views: [], actions: [] }
    if (entry.id === 'apps' || entry.id === 'home') return item
    const route = active ? input.route : { path: entry.to, fullPath: entry.to, query: {}, params: {} }
    const currentPath = normalizedPath(route.path)
    const links = active ? input.contextLinks : contextLinksForModule(entry.id, input.identity, route.path)
    const roots = links.filter(link => !link.pinned && !link.section)
    const createTo = (link: { id: string; to: ShellContextLink['to'] }) => createLinkTo(link, route)
    const quickFor = (path: string) => quickViewsModel({ path, query: normalizedPath(path) === currentPath ? route.query : {}, can: capability => canReach(input.identity, capability), createTo })
    const quick = quickFor(route.path)
    const quickItem = (link: { id: string; labelKey: string; icon: string; to: ShellQuickItem['to']; active?: boolean; primary?: boolean }): ShellQuickItem =>
      ({ id: link.id, label: t(link.labelKey), icon: link.icon, to: link.to, active: active && !!link.active, primary: link.primary })
    const presetActive = active && [...quick.views, ...quick.actions].some(link => link.active)
    const metadata = new WeakMap<ShellNavigationLink, ShellContextLink>()
    const queriedSelection = new Set<ShellNavigationLink>()
    function rowOf(link: ShellContextLink, isActive: boolean): ShellNavigationLink {
      const landing = !link.section && link.labelKey === entry.labelKey && targetPath(link.to) === entry.to
      const row: ShellNavigationLink = {
        id: link.id, label: t(landing ? 'nav.viewAll' : link.labelKey), icon: link.icon,
        to: landing ? landingTarget(link.to, entry.to) : link.to,
        active: active && isActive && !(landing && presetActive), testId: contextLinkTestId(link.id),
      }
      // A manifest's filtered link can lead outside its section (for example Sales → Customers).
      if (active && typeof link.to === 'string' && link.to.includes('?') && targetPath(link.to) === currentPath) {
        const query = new URLSearchParams(link.to.split('?')[1]!.split('#')[0])
        if (query.size && [...query].every(([key, value]) => route.query[key] === value)) {
          row.active = true
          queriedSelection.add(row)
        }
      }
      metadata.set(row, link)
      return row
    }
    const cache = new Map<string, ShellContextLink[]>()
    function contextAt(path: string) {
      if (!cache.has(path)) cache.set(path, contextLinksForModule(entry.id, input.identity, path))
      return cache.get(path)!
    }
    function branchOf(link: ShellContextLink): ShellNavigationLink {
      const row = rowOf(link, !!link.active)
      const path = targetPath(link.to)
      const currentChildren = links.filter(child => child.section === link.labelKey)
      const children = currentChildren.length ? currentChildren : path ? contextAt(path).filter(child => child.section === link.labelKey) : []
      if (children.length) {
        row.children = children.map(child => rowOf(child, currentChildren.some(current => current.id === child.id && current.active)))
        if (!row.children.some(child => targetKey(child.to) === targetKey(row.to))) {
          row.children.unshift({ id: `${row.id}-overview`, label: t('nav.overview'), icon: row.icon, to: row.to, active: row.active && !row.children.some(selected), testId: `${row.testId}-overview` })
        }
      }
      return row
    }
    item.sections = groupSections(roots, link => link.group ?? null).map(section => ({ id: section.id, title: section.titleKey ? t(section.titleKey) : '', items: section.links.map(branchOf) }))
    // Raw metadata supplies lookup paths only; every rendered orphan still passes the provider's access filter.
    const orphans = new Map(links.filter(link => !link.pinned && link.section && !roots.some(root => root.labelKey === link.section)).map(link => [link.id, link]))
    for (const parent of moduleContextLinks(entry.id, route.path)) {
      if (parent.pinned || parent.section || roots.some(root => root.labelKey === parent.labelKey)) continue
      const path = targetPath(parent.to)
      if (!path) continue
      for (const child of contextAt(path).filter(link => !link.pinned && link.section === parent.labelKey)) {
        if (!orphans.has(child.id)) orphans.set(child.id, child)
      }
    }
    for (const group of groupSections([...orphans.values()])) {
      const children = group.links.map(link => rowOf(link, !!link.active))
      const first = children[0]!
      item.sections.push({ id: `orphan-${group.id}`, title: '', items: [{ id: `section-${group.id}`, label: t(group.titleKey!), icon: first.icon, to: first.to, active: children.some(selected), testId: `context-group-${group.id}`, children }] })
    }
    if (!item.sections.some(section => section.items.some(row => targetPath(row.to) === entry.to))) {
      const view = currentPath === entry.to && typeof route.query.view === 'string' ? route.query.view : undefined
      item.sections.unshift({ id: 'main', title: '', items: [{ id: entry.id, label: t('nav.viewAll'), icon: entry.icon, to: landingTarget({ path: entry.to, query: { view } }, entry.to), active: active && currentPath === entry.to && !presetActive, testId: contextLinkTestId(entry.id) }] })
    }
    const pinned = links.filter(link => link.pinned).map(link => quickItem({ ...link, to: createTo(link), primary: true }))
    const seen = new Set<string>()
    item.actions = [...pinned, ...quick.actions.map(quickItem)].filter(action => {
      const key = targetKey(action.to)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    item.views = quick.views.map(quickItem)

    function addPresets(row: ShellNavigationLink) {
      if (row.children?.length) { row.children.forEach(addPresets); return }
      const target = targetPath(row.to)
      if (!target) return
      const source = metadata.get(row)
      const withinQuick = source?.within ? quickFor(source.within) : null
      const hasWithinPresets = withinQuick && (withinQuick.views.length || withinQuick.actions.some(action => !action.primary))
      const path = normalizedPath(hasWithinPresets ? source!.within! : target)
      const rowQuick = hasWithinPresets ? withinQuick : quickFor(path)
      const currentList = path === currentPath
      const toChild = (link: Parameters<typeof quickItem>[0]) => ({ ...quickItem(link), active: active && currentList && !!link.active })
      const views = rowQuick.views.filter(view => targetPath(view.to) === path).map(toChild)
      const actions = rowQuick.actions.filter(action => !action.primary && targetPath(action.to) === path).map(toChild)
      if (!views.length && !actions.length) return
      const selectedPreset = [...views, ...actions].some(child => child.active)
      const view = currentList && typeof route.query.view === 'string' ? route.query.view : undefined
      const retainOverview = normalizedPath(target) !== path || hasHash(row.to)
      const overviewActive = !!row.active && retainOverview && currentPath !== path && !currentPath.startsWith(`${path}/`)
      if (row.label === t('nav.viewAll')) row.label = t('nav.listOf', { name: item.label })
      row.children = [
        ...(retainOverview ? [{ id: `${row.id}-overview`, label: t('nav.overview'), icon: row.icon, to: row.to, active: overviewActive, testId: `${row.testId}-overview` }] : []),
        { id: `${row.id}-all`, label: t('nav.viewAll'), icon: row.icon, to: landingTarget({ path, query: { view } }, path), active: row.active && !selectedPreset && !overviewActive, testId: `${row.testId}-all` },
        ...views.map(child => ({ ...child, testId: `quick-view-${child.id}` })),
        ...actions.map(child => ({ ...child, testId: `quick-action-${child.id}` })),
      ]
      row.active = row.active && !selectedPreset
      item.views = item.views.filter(view => targetPath(view.to) !== path)
      item.actions = item.actions.filter(action => action.primary || targetPath(action.to) !== path)
    }
    item.sections.forEach(section => section.items.forEach(addPresets))
    // A scoped list can have presets without a global navigation row (for example tasks inside a project).
    const remainingPaths = new Set(item.views.map(view => targetPath(view.to)).filter((path): path is string => !!path))
    for (const path of remainingPaths) {
      if (!canReachPath(input.identity, path)) continue
      const row: ShellNavigationLink = { id: `list-${path}`, label: t('nav.quickViews'), icon: 'i-lucide-list-filter', to: path, active, testId: `context-list-${path}` }
      addPresets(row)
      item.sections.push({ id: `list-${path}`, title: '', items: [row] })
    }
    // The filtered destination owns the selection instead of its unfiltered sibling.
    if (queriedSelection.size) {
      function clearUnfiltered(rows: ShellNavigationLink[]) {
        for (const row of rows) {
          if (targetPath(row.to) === currentPath && !queriedSelection.has(row)) row.active = false
          if (row.children) clearUnfiltered(row.children)
        }
      }
      item.sections.forEach(section => clearUnfiltered(section.items))
    }
    item.views = []
    item.panel = active && !!sidebarPanelFor(entry.id)
    return item
  })
}
