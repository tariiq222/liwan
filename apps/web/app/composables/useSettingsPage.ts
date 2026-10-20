import { visibleSettingsPages } from './nav/shellModules'

/**
 * The cards of one settings page this user may see, with the page's scroll-spy running over them. A page renders a
 * card only when `shows(id)` is true, so a part hidden from the sidebar is hidden on the page too.
 */
export function useSettingsPage(pageId: string) {
  const { me } = useMe()
  const parts = computed(() => visibleSettingsPages(me.value).find(({ page }) => page.id === pageId)?.parts ?? [])
  useSettingsScrollSpy(() => parts.value.map(part => part.id))
  return { parts, shows: (id: string) => parts.value.some(part => part.id === id) }
}
