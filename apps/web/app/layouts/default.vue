<script setup lang="ts">
import { isWorkspaceThemeRoute } from '@/utils/workspacePresentation'
import { hasNoContextSidebar } from '@/components/shell/noContextRoutes'
const route = useRoute()
const workspaceTheme = computed(() => isWorkspaceThemeRoute(route.path))
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
  <ShellFrame :no-sidebar="noSidebar">
    <template #header><ShellHeader /></template>
    <template #sidebar><ShellAppSidebar /></template>
    <main ref="shellMain" tabindex="-1" data-testid="shell-main" class="nasq-shell-main focus:outline-none" :class="{ 'nasq-page-content-motion': pageMotionActive }">
      <slot />
    </main>
  </ShellFrame>
</template>
