import { activeNavId, adminNav, splitRail } from '@/utils/adminNav'

/** The sections the signed-in account may see and the one the current route belongs to. */
export function useAdminNav() {
  const me = useAdminMe()
  const route = useRoute()
  const items = computed(() => adminNav(me.value?.capabilities ?? []))
  const rail = computed(() => splitRail(items.value))
  const activeId = computed(() => activeNavId(items.value, route.path))
  return { items, rail, activeId }
}
