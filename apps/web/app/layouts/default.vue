<script setup lang="ts">
import { activeShellModule } from '@/composables/useNav'
import { projectIdFromPath } from '@/composables/useShellNavigation'

const { localeProperties } = useI18n()
const route = useRoute()
const dir = computed(() => localeProperties.value.dir ?? 'ltr')
const showContext = computed(() => activeShellModule(route.path) !== 'projects' || projectIdFromPath(route.path) !== null)
</script>

<template>
  <div data-nasq-shell class="nasq-shell" :data-direction="dir" :data-context-sidebar="showContext ? 'visible' : 'hidden'">
    <ShellHeader />
    <AppSidebar :show-context="showContext" />
    <div class="nasq-shell-workspace">
      <ShellBreadcrumb />
      <main data-testid="shell-main" class="nasq-shell-main">
        <slot />
      </main>
    </div>
    <Toaster :dir="dir" />
  </div>
</template>
