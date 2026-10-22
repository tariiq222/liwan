<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import ModuleRail from '@webvue/ui/app/components/shell/ModuleRail.vue'
import ShellContextSubList from '@webvue/ui/app/components/shell/ShellContextSubList.vue'
import ShellQuickViews from '@webvue/ui/app/components/shell/ShellQuickViews.vue'
import ContextSidebar from './ContextSidebar.vue'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useShellModel } from '@/composables/useShellModel'
import { useQuickViews } from '@/composables/useQuickViews'
import { contextLinkTestId, sidebarModel, subListSections } from '@/composables/nav/sidebarModel'
import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'
import { overlayOwnsEscape } from '@webvue/ui/app/composables/useEscapeBack'
import { hasNoContextSidebar } from './noContextRoutes'

// Desktop navigation: the module rail and the context sidebar, fed by one model.
const route = useRoute()
const showContext = computed(() => !hasNoContextSidebar(route.path))
const { t } = useI18n()
const quick = useQuickViews()
const { railActive, rail, homePath, contextTitle, contextLabelKey, contextLinks, panel, panelView, motionKey, createTo } = useShellModel()
const { expanded, hydrated, forced, toggle, preference } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const model = computed(() => sidebarModel({
  links: contextLinks.value,
  moduleLabelKey: contextLabelKey.value,
  path: route.path,
  panel: panel.value && isDesktop.value ? { expanded: expanded.value } : null,
  surface: 'desktop',
}))
const subSections = computed(() => subListSections(model.value.subSections, t, contextLinkTestId))
const createLinks = computed(() => model.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
// The PMO my-tasks counter is deferred (owner decision); no shell request feeds counts yet.
const counts: Record<string, number> = {}

// `[` (by physical key) collapses or expands the sidebar on desktop; never while typing or in a menu/dialog.
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggle()
})
</script>

<template>
  <ModuleRail :rail="rail" :active-id="railActive" :home-to="homePath" />
  <div v-if="showContext" class="webvue-context-column">
    <ContextSidebar
      :title="contextTitle"
      :create-links="createLinks"
      :sections="model.sections"
      :show-nav="model.showNav"
      :counts="counts"
      :expanded="expanded"
      :preference="preference"
      :hydrated="hydrated"
      :locked="forced"
      :panel="panelView"
      :render-panel="isDesktop"
      :panel-width="panel?.width ?? 'default'"
      :motion-key="motionKey"
      @toggle="toggle"
    />
    <ShellContextSubList :label="contextTitle" :sections="subSections" :collapsed="!expanded" />
    <ShellQuickViews
      :label="t('nav.quickViews')"
      :views-label="t('nav.quickViewsList')"
      :actions-label="t('nav.quickActionsList')"
      :views="quick.views.value"
      :actions="quick.actions.value"
      :collapsed="!expanded"
    />
  </div>
</template>
