import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useNav } from './nav/shellModules'
import { canReach, canReachPath, type AccessIdentity } from '../utils/accessPolicy'
import { activeManifests, manifestForPath } from '../modules/manifests'
import { safeReturnTo } from '@nasq/ui/app/utils/safeReturnTo'

function registeredListSources(identity: AccessIdentity, candidates: unknown[]): string[] {
  return candidates.flatMap(candidate => {
    const safe = safeReturnTo(candidate, '', activeManifests().flatMap(manifest => manifest.routePrefixes))
    if (!safe) return []
    const path = new URL(safe, 'http://nasq.local').pathname
    const owner = manifestForPath(path)
    const source = owner?.recordListSources?.find(entry => entry.pattern.test(path))
    return source && canReachPath(identity, path) && canReach(identity, source.capability, path) ? [path] : []
  })
}

/** Exact source destinations: the owning list, accessible navigation and shared search/inbox. */
export function useRecordListPaths(owning: MaybeRefOrGetter<readonly string[]>) {
  const { me } = useMe()
  const route = useRoute()
  return computed(() => [...new Set([
    ...toValue(owning).filter(path => canReachPath(me.value, path)),
    ...useNav(me.value).map(item => item.to).filter(path => path !== '/odoo'),
    ...registeredListSources(me.value, [route.query.returnTo, route.query.listOrigin]),
    '/search',
    ...(canReach(me.value, 'nasq.notifications') ? ['/notifications'] : []),
  ])])
}
