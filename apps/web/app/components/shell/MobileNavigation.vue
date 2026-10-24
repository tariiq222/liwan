<script setup lang="ts">
import type { SlideoverProps } from '@nuxt/ui'
import { useMediaQuery } from '@vueuse/core'
import ShellNavigation from '@webvue/ui/app/components/shell/ShellNavigation.vue'
import type { ShellNavigationItem, ShellQuickItem } from '@webvue/ui/app/types/shell'
import { isSamePageAnchor } from '@/composables/nav/settingsScroll'

const props = defineProps<{ items: ShellNavigationItem[]; activeId: string | null; homeTo: string }>()
const open = defineModel<boolean>('open', { default: false })
const { t, te, localeProperties } = useI18n()
const route = useRoute()
const router = useRouter()
const hydrated = useHydrated()
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })
const menuTitle = computed(() => te('nav.navigation') ? t('nav.navigation') : t('nav.modules'))
const openMenuLabel = computed(() => te('nav.openMenu') ? t('nav.openMenu') : t('nav.toggleSidebar'))
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'mobile-navigation' }))
watch(desktop, value => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })
function onNavigate(item: ShellQuickItem) {
  if (isSamePageAnchor(item, route.path) || router.resolve(item.to).fullPath === route.fullPath) open.value = false
}
</script>

<template>
  <USlideover v-model:open="open" :side="localeProperties.dir === 'rtl' ? 'right' : 'left'" :title="menuTitle" :description="t('nav.apps')" :content="dialogContent" :ui="{ content: 'webvue-mobile-menu', overlay: 'webvue-mobile-menu-overlay' }">
    <UButton id="mobile-navigation-trigger" class="webvue-mobile-menu-trigger" type="button" color="neutral" variant="ghost" square data-testid="mobile-navigation-trigger" aria-controls="mobile-navigation" :aria-expanded="open" :aria-label="openMenuLabel" :disabled="!hydrated">
      <template #leading><UIcon name="i-lucide-menu" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" /></template>
    </UButton>
    <template #body>
      <ShellNavigation surface="drawer" :items="props.items" :active-id="props.activeId" :route-key="route.fullPath" :home-to="props.homeTo" :expanded="true" :hydrated="hydrated" @navigate="onNavigate" />
    </template>
  </USlideover>
</template>
