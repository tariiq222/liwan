<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
const { t, locale, route, module } = usePreview()
const router = useRouter()
const open = ref(false)
const desktop = useMediaQuery('(min-width: 768px)')
watch(desktop, value => { if (value) open.value = false })
// A guarded/aborted navigation must leave the menu and the form draft intact.
watch(() => route.fullPath, () => { open.value = false })
function closeIfCurrent(path: string, targetModule: string) {
  if (router.resolve({ path, query: { module: targetModule } }).fullPath === route.fullPath) open.value = false
}
</script>
<template>
  <USlideover v-model:open="open" :side="locale === 'ar' ? 'right' : 'left'" :title="t('navigation')" :description="t(module)" :ui="{ content: 'preview-mobile-menu', overlay: 'preview-mobile-menu-overlay' }">
    <UButton class="preview-mobile-menu-trigger preview-header-button" type="button" color="neutral" variant="ghost" icon="i-lucide-menu" :aria-label="t('openMenu')" />
    <template #body>
      <nav :aria-label="t('workspace')" class="grid gap-2">
        <UButton v-for="(name, index) in previewModules" :key="name" :to="{ path: '/list', query: { module: name } }" :icon="previewModuleIcons[index]" :label="t(name)" :aria-current="module === name ? 'page' : undefined" color="neutral" variant="ghost" class="preview-context-link" @click="closeIfCurrent('/list', name)" />
      </nav>
      <div class="border-t border-default my-6" />
      <h2 class="preview-section-title mb-3">{{ t(module) }}</h2>
      <nav :aria-label="t('recipes')" class="grid gap-2">
        <UButton v-for="(view, index) in previewViews" :key="view" :to="{ path: `/${view}`, query: { module } }" :icon="previewViewIcons[index]" :label="t(view)" :aria-current="route.path === `/${view}` ? 'page' : undefined" color="neutral" variant="ghost" class="preview-context-link" @click="closeIfCurrent(`/${view}`, module)" />
      </nav>
    </template>
  </USlideover>
</template>
