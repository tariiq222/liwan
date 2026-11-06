import { settingsActiveGroup, visibleSettingsGroups } from './nav/settingsSections'
import { visibleSettingsPages } from './nav/shellModules'

/**
 * The cards of one settings page this user may see, with the page's scroll-spy running over the cards on show. A page
 * renders a card only when `shows(id)` is true, so a part hidden from the sidebar is hidden on the page too.
 *
 * A long page is split into tabs: `tabItems` feeds `SharedRouteTabs`, `activeTab` is the group in the address
 * (`#part` wins, then `?tab=`, then the first visible group) and `inTab(id)` says whether a card sits on it. A part in
 * no group sits above the tabs and shows on every one of them, and a page without groups shows every card.
 */
export function useSettingsPage(pageId: string) {
  const { me } = useMe()
  const { t } = useI18n()
  const route = useRoute()
  // The server never sees the hash, so the first client render must not pick a tab from it (hydration).
  const hydrated = useHydrated()
  const visible = computed(() => visibleSettingsPages(me.value).find(({ page }) => page.id === pageId))
  const parts = computed(() => visible.value?.parts ?? [])
  const groups = computed(() => visibleSettingsGroups(visible.value?.page.groups, parts.value.map(part => part.id)))
  const activeTab = computed(() => settingsActiveGroup(groups.value, hydrated.value ? route.hash : '', route.query.tab))
  const inTab = (partId: string) => {
    const group = groups.value.find(candidate => candidate.parts.includes(partId))
    return !group || group.id === activeTab.value
  }
  useSettingsScrollSpy(() => parts.value.filter(part => inTab(part.id)).map(part => part.id))
  // One visible group needs no strip: the reader sees its cards without a tab to choose.
  const tabItems = computed(() => groups.value.length < 2 ? [] : groups.value.map(group => ({
    key: `settings-tab-${group.id}`,
    label: t(group.labelKey),
    // The hash names a card of another tab, so a tab link clears it and the query alone decides the tab.
    to: { query: { ...route.query, tab: group.id }, hash: '' },
    active: group.id === activeTab.value,
  })))
  return {
    parts,
    groups,
    activeTab,
    tabItems,
    inTab,
    shows: (id: string) => parts.value.some(part => part.id === id),
  }
}
