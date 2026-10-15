import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { useNav } from './nav/shellModules'
import { canReach, canReachPath } from '../utils/accessPolicy'

/** Exact source destinations: the owning list, accessible navigation and shared search/inbox. */
export function useRecordListPaths(owning: MaybeRefOrGetter<readonly string[]>) {
  const { me } = useMe()
  return computed(() => [...new Set([
    ...toValue(owning).filter(path => canReachPath(me.value, path)),
    ...useNav(me.value).map(item => item.to).filter(path => path !== '/odoo'),
    '/search',
    ...(canReach(me.value, 'nasq.notifications') ? ['/notifications'] : []),
  ])])
}
