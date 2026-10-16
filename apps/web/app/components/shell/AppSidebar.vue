<script setup lang="ts">
import { useEventListener, useMediaQuery } from '@vueuse/core'
import ModuleRail from '@nasq/ui/app/components/shell/ModuleRail.vue'
import ContextSidebar from './ContextSidebar.vue'
import { useContextSidebar } from '@/composables/useShellNavigation'
import { useShellModel } from '@/composables/useShellModel'
import { sidebarModel } from '@/composables/nav/sidebarModel'
import { isSidebarToggleShortcut } from '@/composables/nav/sidebarShortcut'
import { overlayOwnsEscape } from '@nasq/ui/app/composables/useEscapeBack'
import { hasNoContextSidebar } from './noContextRoutes'

// Desktop navigation: the module rail and the context sidebar, fed by one model.
const route = useRoute()
const showContext = computed(() => !hasNoContextSidebar(route.path))
const { me } = useMe()
const { activeModule, rail, homePath, contextTitle, contextLabelKey, contextLinks, panel, panelView, motionKey, projectId, project, createTo } = useShellModel()
const { expanded, hydrated, toggle, preference } = useContextSidebar()
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const model = computed(() => sidebarModel({
  links: contextLinks.value,
  moduleLabelKey: contextLabelKey.value,
  path: route.path,
  panel: panel.value && isDesktop.value ? { expanded: expanded.value } : null,
  surface: 'desktop',
}))
const createLinks = computed(() => model.value.createLinks.map(link => ({ ...link, to: createTo(link) })))
// The PMO my-tasks counter is deferred (owner decision); no shell request feeds counts yet.
const counts: Record<string, number> = {}

// `[` (by physical key) collapses or expands the sidebar on desktop; never while typing or in a menu/dialog.
useEventListener('keydown', (event: KeyboardEvent) => {
  if (!isDesktop.value || !isSidebarToggleShortcut(event, overlayOwnsEscape(document))) return
  event.preventDefault()
  toggle()
})

// Remember the last readable project section for re-entry (moved from ContextSidebar).
const isProject = computed(() => !!projectId.value && activeModule.value === 'projects')
const { remember } = useProjectWorkspaceMemory()
watch([() => route.fullPath, () => project.data.value, () => me.value, hydrated], () => {
  if (isProject.value && project.data.value?.id === projectId.value && !project.error.value) remember(route.path, route.query)
}, { immediate: true })
</script>

<template>
  <ModuleRail :modules="rail.primary" :utility="rail.utility" :active-id="activeModule" :home-to="homePath" />
  <ContextSidebar
    v-if="showContext"
    :title="contextTitle"
    :create-links="createLinks"
    :sections="model.sections"
    :show-nav="model.showNav"
    :counts="counts"
    :expanded="expanded"
    :preference="preference"
    :hydrated="hydrated"
    :panel="panelView"
    :render-panel="isDesktop"
    :panel-width="panel?.width ?? 'default'"
    :motion-key="motionKey"
    @toggle="toggle"
  />
</template>
