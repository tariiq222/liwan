<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import ModuleRail from '@webvue/ui/app/components/shell/ModuleRail.vue'
import { hasNoContextSidebar } from './noContextRoutes'
import ShellNavigation from '@webvue/ui/app/components/shell/ShellNavigation.vue'
import { overlayOwnsEscape } from '@webvue/ui/app/composables/useEscapeBack'
import { useApplicationNavigation } from '@/composables/useApplicationNavigation'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'

const route = useRoute()
const navigation = useApplicationNavigation()
const contextItems = computed(() => navigation.items.value.filter(item => item.id === navigation.activeId.value))
const showContext = computed(() => !hasNoContextSidebar(route.path) && contextItems.value.length > 0)
const { expanded, hydrated, forced, toggle, preference } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggle()
})
</script>

<template>
  <ModuleRail :rail="navigation.rail.value" :active-id="navigation.railActive.value" :home-to="navigation.homePath.value" />
  <div v-if="showContext" class="webvue-context-column">
    <ShellNavigation
      surface="context"
      :items="contextItems"
      :title="navigation.title.value"
      hide-brand
      :active-id="navigation.activeId.value"
      :route-key="navigation.routeKey.value"
      :home-to="navigation.homePath.value"
      :expanded="expanded"
      :hydrated="hydrated"
      :locked="forced"
      :preference="preference"
      :show-panel="isDesktop"
      :panel-width="navigation.panel.value?.width ?? 'default'"
      @toggle="toggle"
    >
      <template #panel><component :is="navigation.panelView.value" v-if="navigation.panelView.value" /></template>
    </ShellNavigation>
  </div>
</template>
