<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import AppSidebar from '@/components/shell/AppSidebar.vue'

// The phone drawer behind «المزيد»: the same sidebar content as the desktop column (the organisation, the
// applications, or the open application's links), from the inline-start side. It closes after a navigation, on a
// route change and when the screen grows past the phone width.
const open = defineModel<boolean>('open', { default: false })
const { t, localeProperties } = useI18n()
const route = useRoute()
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))
watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })
</script>

<template>
  <USlideover v-model:open="open" :side="localeProperties.dir === 'rtl' ? 'right' : 'left'" :title="t('nav.navigation')" :description="t('nav.apps')" :content="dialogContent" :ui="{ content: 'liwan-mobile-menu', overlay: 'liwan-mobile-menu-overlay' }">
    <template #body>
      <AppSidebar surface="drawer" @navigate="open = false" />
    </template>
  </USlideover>
</template>
