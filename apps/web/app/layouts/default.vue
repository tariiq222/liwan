<script setup lang="ts">
import { isWorkspaceThemeRoute } from '@/utils/workspacePresentation'
const { localeProperties } = useI18n()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
const route = useRoute()
const workspaceTheme = computed(() => isWorkspaceThemeRoute(route.path))
const projectTheme = computed(() => /^\/(projects|project-templates)(\/|$)/.test(route.path) || /^\/settings\/projects(\/|$)/.test(route.path))
// Portaled project sheets, notifications and menus inherit the same tokens.
useHead(() => ({ htmlAttrs: { 'data-project-theme': projectTheme.value ? 'true' : undefined, 'data-workspace-theme': workspaceTheme.value ? 'true' : undefined } }))
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
watch(() => route.path, triggerPageMotion)
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
      <main data-testid="shell-main" class="nasq-shell-main" :class="{ 'nasq-page-content-motion': pageMotionActive }">
        <slot />
      </main>
    </div>
  </div>
</template>
