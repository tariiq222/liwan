import type { ShellNavigationItem, ShellQuickItem } from '@webvue/ui/app/types/shell'
import { canReach, type AccessIdentity } from '../../utils/accessPolicy'
import { sidebarPanelFor } from '../../modules/surfaces'
import { createLinkTo, type CreateActionRoute } from './createActions'
import { contextLinksForModule, visibleShellModules, type ShellContextLink } from './shellModules'
import { contextLinkTestId, groupSections, railModel } from './sidebarModel'
import { quickViewsModel } from './quickViewsModel'

export interface ApplicationNavigationInput {
  identity: AccessIdentity
  route: CreateActionRoute
  activeId: string | null
  contextLinks: readonly ShellContextLink[]
  translate: (key: string) => string
}

function targetPath(to: ShellQuickItem['to']) {
  return typeof to === 'string' ? to.split(/[?#]/, 1)[0] : 'path' in to ? to.path : undefined
}

function landingTarget(to: ShellQuickItem['to'], path: string): ShellQuickItem['to'] {
  const view = typeof to !== 'string' && 'query' in to ? to.query?.view : undefined
  return view === undefined ? path : { path, query: { view } }
}

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

    // An unopened app must not inherit the current app's query or creation context.
    const route = active ? input.route : { path: entry.to, fullPath: entry.to, query: {}, params: {} }
    const links = active ? input.contextLinks : contextLinksForModule(entry.id, input.identity, route.path)
    const navigation = links.filter(link => !link.pinned)
    const createTo = (link: { id: string; to: ShellContextLink['to'] }) => createLinkTo(link, route)
    const quick = quickViewsModel({ path: route.path, query: route.query, can: capability => canReach(input.identity, capability), createTo })
    const quickItem = (link: { id: string; labelKey: string; icon: string; to: ShellQuickItem['to']; active?: boolean; primary?: boolean }): ShellQuickItem =>
      ({ id: link.id, label: t(link.labelKey), icon: link.icon, to: link.to, active: active && !!link.active, primary: link.primary })
    const presetActive = active && [...quick.views, ...quick.actions].some(link => link.active)
    item.views = quick.views.map(quickItem)
    item.sections = groupSections(navigation, link => link.section ?? link.group ?? null).map(section => ({
      id: section.id,
      title: section.titleKey ? t(section.titleKey) : '',
      items: section.links.map(link => {
        const landing = link.labelKey === entry.labelKey && targetPath(link.to) === entry.to
        return {
          id: link.id, label: t(landing ? 'nav.viewAll' : link.labelKey), icon: link.icon,
          to: landing ? landingTarget(link.to, entry.to) : link.to,
          active: active && !!link.active && !(landing && presetActive),
          testId: contextLinkTestId(link.id),
        }
      }),
    }))
    if (!item.sections.some(section => section.items.some(link => targetPath(link.to) === entry.to))) {
      const view = route.path === entry.to && typeof route.query.view === 'string' ? route.query.view : undefined
      item.sections.unshift({ id: 'main', title: '', items: [{ id: entry.id, label: t('nav.viewAll'), icon: entry.icon, to: landingTarget({ path: entry.to, query: { view } }, entry.to), active: active && input.route.path === entry.to && !presetActive, testId: contextLinkTestId(entry.id) }] })
    }
    const pinned = links.filter(link => link.pinned).map(link => quickItem({ ...link, to: createTo(link), primary: true }))
    const seen = new Set<string>()
    item.actions = [...pinned, ...quick.actions.map(quickItem)].filter(action => {
      const key = typeof action.to === 'string' ? action.to : JSON.stringify(action.to)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    item.panel = active && !!sidebarPanelFor(entry.id)
    return item
  })
}
