<script setup lang="ts">
import { pageArea } from '@/utils/workspacePresentation'
import { hasNoContextSidebar } from '@/components/shell/noContextRoutes'
import { shellBreadcrumb } from '@/composables/nav/breadcrumb'
import { useShellModel } from '@/composables/useShellModel'
import { useAssistantSheet } from '@/composables/useAssistantSheet'
import AssistantSheet from '@/components/shell/AssistantSheet.vue'
import { usePageHeaderTitle } from '@webvue/ui/app/composables/usePageHeader'
import { providePageTrail } from '@webvue/ui/app/composables/usePageTrail'
import { providePageApp } from '@webvue/ui/app/composables/usePageApp'
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { rail, activeModule } = useShellModel()
const assistant = useAssistantSheet()
const pageTitle = usePageHeaderTitle()
// The trail belongs to the page header now (DESIGN.md §3): the shell publishes the ancestors of the
// current route and SharedPageHeader draws them under the page title, so the floating header stays
// quiet and there is still one trail, not two. The page title arrives after hydration (the page
// registers it) and the shell names the current page only then, so both renders agree.
const trail = computed(() => shellBreadcrumb({ path: route.path, pageTitle: hydrated.value ? pageTitle.value : null, t, rail: rail.value.all }))
providePageTrail(trail)
// The page header draws the chip before its title from the application that owns the route; a page
// no application owns (account, search) gets the generic icon.
providePageApp(() => {
  const owner = rail.value.all.find(item => item.id === activeModule.value)
  if (!owner) return { icon: 'i-lucide-layout-grid' }
  return { icon: owner.icon, label: t(owner.labelKey), to: owner.to }
})
const workspaceTheme = computed(() => !pageArea(route.path).plain)
const noSidebar = computed(() => hasNoContextSidebar(route.path))
// The deleted route sheet restored focus when it closed; an ordinary page has
// no such moment, so a keyboard or screen-reader user pressing Escape on a
// record used to land on the list with focus on <body>. Moving focus to the
// main region after each navigation replaces that. Pages are not dialogs, so
// this is a focus move, not a trap, and the first load is left alone.
const shellMain = ref<HTMLElement | null>(null)
const pageMotionActive = ref(false)
let pageMotionTimer: ReturnType<typeof setTimeout> | undefined
let pageMotionFrame: number | undefined

function triggerPageMotion() {
  pageMotionActive.value = false
  if (pageMotionTimer) clearTimeout(pageMotionTimer)
  if (pageMotionFrame !== undefined) cancelAnimationFrame(pageMotionFrame)
  // Project navigation replaces the section in a stable workspace. Replaying
  // the whole content entrance looks like a reload and also moves its sheet.
  if (workspaceTheme.value) return
  pageMotionFrame = requestAnimationFrame(() => {
    pageMotionActive.value = true
    pageMotionTimer = setTimeout(() => { pageMotionActive.value = false }, 180)
  })
}

onMounted(triggerPageMotion)
// route.path, not fullPath: a same-page filter or tab change must not yank
// focus out of the control the user is currently operating.
watch(() => route.path, () => {
  triggerPageMotion()
  if (!import.meta.client) return
  // preventScroll leaves Nuxt's own scroll restoration in charge.
  nextTick(() => shellMain.value?.focus({ preventScroll: true }))
})
onBeforeUnmount(() => {
  if (pageMotionTimer) clearTimeout(pageMotionTimer)
  if (pageMotionFrame !== undefined) cancelAnimationFrame(pageMotionFrame)
})
</script>

<template>
  <ShellFrame :no-sidebar="noSidebar" :sheet-open="assistant.shown.value">
    <template #header><ShellHeader /></template>
    <template #sidebar><ShellAppSidebar /></template>
    <template #sheet><AssistantSheet v-if="assistant.surface.value" :surface="assistant.surface.value" /></template>
    <main ref="shellMain" tabindex="-1" data-testid="shell-main" class="webvue-shell-main focus:outline-none" :class="{ 'webvue-page-content-motion': pageMotionActive }">
      <slot />
    </main>
  </ShellFrame>
</template>
