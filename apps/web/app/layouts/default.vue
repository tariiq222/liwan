<script setup lang="ts">
import { isWorkspaceThemeRoute } from '@/utils/workspacePresentation'
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
const route = useRoute()
const workspaceTheme = computed(() => isWorkspaceThemeRoute(route.path))
const projectTheme = computed(() => /^\/(projects|project-templates)(\/|$)/.test(route.path) || /^\/settings\/projects(\/|$)/.test(route.path))
// Portaled project sheets, notifications and menus inherit the same tokens.
useHead(() => ({ htmlAttrs: { 'data-project-theme': projectTheme.value ? 'true' : undefined, 'data-workspace-theme': workspaceTheme.value ? 'true' : undefined } }))
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
  <div data-nasq-shell class="nasq-shell" :data-direction="dir">
    <ShellHeader />
    <AppSidebar />
    <div class="nasq-shell-workspace">
      <main ref="shellMain" tabindex="-1" data-testid="shell-main" class="nasq-shell-main focus:outline-none" :class="{ 'nasq-page-content-motion': pageMotionActive }">
        <slot />
      </main>
    </div>
  </div>
</template>
