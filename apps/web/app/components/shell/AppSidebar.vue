<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import ModuleRail from '@liwan/ui/app/components/shell/ModuleRail.vue'
import { hasNoContextSidebar } from './noContextRoutes'
import ShellNavigation from '@liwan/ui/app/components/shell/ShellNavigation.vue'
import type { ShellNavigationItem } from '@liwan/ui/app/types/shell'
import { overlayOwnsEscape } from '@liwan/ui/app/composables/useEscapeBack'
import { useApplicationNavigation } from '@/composables/useApplicationNavigation'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useContextPeek } from '@/composables/useContextPeek'
import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'

const route = useRoute()
const navigation = useApplicationNavigation()
const { expanded, hydrated, forced, toggle, preference } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const canHover = useMediaQuery('(hover: hover)', { ssrWidth: 1024 })
const overlay = computed(() => hydrated.value && isDesktop.value && canHover.value && !expanded.value && !forced.value)
const { peekId, pinnedId, peek, keep, release, close, dismissOnEscape, pin, unpin } = useContextPeek(overlay)
watch(navigation.routeKey, () => { close(); unpin() })
watch(expanded, value => { if (!value) unpin() })
const hasMenu = (item: ShellNavigationItem) => !item.panel && !!(item.sections.length || item.views.length || item.actions.length)
const menuItem = (id: string | null) => navigation.items.value.find(item => item.id === id && hasMenu(item)) ?? null
const peekItem = computed(() => menuItem(peekId.value))
const shownItem = computed(() => peekItem.value ?? menuItem(pinnedId.value))
const contextItems = computed(() => shownItem.value ? [shownItem.value] : navigation.items.value.filter(item => item.id === navigation.activeId.value))
const showContext = computed(() => !!shownItem.value || (!hasNoContextSidebar(route.path) && contextItems.value.length > 0))
function toggleSidebar() {
  pin()
  toggle()
}
// Focus stays on the rail link that opened a hovered menu, so Escape is read before any page handler.
useEventListener(() => typeof document === 'undefined' ? null : document, 'keydown', (event: KeyboardEvent) => {
  if (!overlayOwnsEscape(document)) dismissOnEscape(event)
}, { capture: true })
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggleSidebar()
})
</script>

<template>
  <ModuleRail :rail="navigation.rail.value" :active-id="navigation.railActive.value" :home-to="navigation.homePath.value" @peek="peek" @release="release" />
  <div v-if="showContext" class="liwan-context-column" @pointerenter="keep" @pointerleave="release" @focusin="keep" @focusout="release">
    <ShellNavigation
      surface="context"
      :items="contextItems"
      :title="shownItem?.label ?? navigation.title.value"
      hide-brand
      :active-id="shownItem?.id ?? navigation.activeId.value"
      :route-key="navigation.routeKey.value"
      :home-to="navigation.homePath.value"
      :expanded="expanded || !!peekItem"
      :overlay="!!peekItem"
      :hydrated="hydrated"
      :locked="forced"
      :preference="preference"
      :show-panel="isDesktop"
      :panel-width="navigation.panel.value?.width ?? 'default'"
      @toggle="toggleSidebar"
    >
      <template #panel><component :is="navigation.panelView.value" v-if="navigation.panelView.value" /></template>
    </ShellNavigation>
  </div>
</template>
