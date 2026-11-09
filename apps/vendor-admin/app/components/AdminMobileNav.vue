<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { SlideoverProps } from '@nuxt/ui'
import type { ShellRailItem } from '@liwan/ui/app/types/shell'

// The same sections as the sidebar, in a drawer below 768px where the sidebar is hidden.
const props = defineProps<{ items: ShellRailItem[], activeId: string | null }>()
const open = ref(false)
const { t, localeProperties } = useI18n()
const route = useRoute()
const hydrated = useHydrated()
const dialogContent = computed<NonNullable<SlideoverProps['content']> & { id: string }>(() => ({ id: 'admin-mobile-navigation' }))
const desktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })

watch(desktop, (value) => { if (value) open.value = false })
watch(() => route.fullPath, () => { open.value = false })
</script>

<template>
  <USlideover
    v-model:open="open"
    :side="localeProperties.dir === 'rtl' ? 'right' : 'left'"
    :title="t('app.shell.navigation')"
    :description="t('app.shell.consoleBadge')"
    :content="dialogContent"
    :ui="{ content: 'liwan-mobile-menu', overlay: 'liwan-mobile-menu-overlay' }"
  >
    <UButton
      class="liwan-mobile-menu-trigger"
      type="button"
      color="neutral"
      variant="ghost"
      square
      data-testid="mobile-navigation-trigger"
      :aria-expanded="open"
      :aria-label="t('app.shell.openMenu')"
      :disabled="!hydrated"
    >
      <template #leading>
        <UIcon name="i-lucide-menu" class="liwan-shell-icon size-4.5 shrink-0" aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <nav data-fresh-navigation data-testid="mobile-nav" :aria-label="t('app.shell.navigation')" class="liwan-mobile-section">
        <ShellNavRow
          v-for="item in props.items"
          :key="item.id"
          :item="{ id: item.id, label: t(item.labelKey), icon: item.icon, to: item.to, active: props.activeId === item.id }"
          :test-id="`mobile-nav-${item.id}`"
          @navigate="open = false"
        />
      </nav>
    </template>
  </USlideover>
</template>
