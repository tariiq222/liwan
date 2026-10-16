<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { SlideoverProps } from '@nuxt/ui'
import type { ShellRailItem } from '@webvue/ui/app/types/shell'

// The same sections as the module rail, in a drawer below 768px where the rail is hidden.
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
    :ui="{ content: 'webvue-mobile-menu', overlay: 'webvue-mobile-menu-overlay' }"
  >
    <UButton
      class="webvue-mobile-menu-trigger"
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
        <UIcon name="i-lucide-menu" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
      </template>
    </UButton>
    <template #body>
      <nav data-fresh-navigation data-testid="mobile-nav" :aria-label="t('app.shell.navigation')" class="webvue-mobile-section">
        <UButton
          v-for="item in props.items"
          :key="item.id"
          :to="item.to"
          color="neutral"
          variant="ghost"
          class="webvue-context-link"
          :data-testid="`mobile-nav-${item.id}`"
          :data-active="props.activeId === item.id"
          :active="props.activeId === item.id"
          :aria-current="props.activeId === item.id ? 'page' : undefined"
          @click="open = false"
        >
          <template #leading>
            <UIcon :name="item.icon" class="webvue-shell-icon size-4.5 shrink-0" aria-hidden="true" />
          </template>
          <span data-slot="label">{{ t(item.labelKey) }}</span>
        </UButton>
      </nav>
    </template>
  </USlideover>
</template>
