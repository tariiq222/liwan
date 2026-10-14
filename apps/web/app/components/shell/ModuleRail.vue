<script setup lang="ts">
import BrandWordmark from '@/components/shared/BrandWordmark.vue'
import type { ShellRailItem } from '@/composables/nav/sidebarModel'

// The module rail (spec §3, §5): always Nasq midnight, 64px, icon over a small
// label; the active module carries a lime bar on the rail's inline-start edge.
const props = defineProps<{
  modules: ShellRailItem[]
  utility: ShellRailItem[]
  activeId: string | null
  homeTo: string
}>()
const { t } = useI18n()
const groups = computed(() => [
  { key: 'modules', items: props.modules, label: t('nav.railApps'), class: 'nasq-module-rail-links' },
  { key: 'utility', items: props.utility, label: t('nav.railAdmin'), class: 'nasq-module-rail-utility' },
].filter(group => group.items.length))
</script>

<template>
  <aside data-testid="module-rail" class="nasq-module-rail" :aria-label="t('nav.modules')">
    <NuxtLink :to="props.homeTo" class="nasq-module-rail-brand" :aria-label="`${t('app.productName')} — ${t('nav.home')}`">
      <BrandWordmark size="sm" inverted />
    </NuxtLink>
    <nav v-for="group in groups" :key="group.key" :class="group.class" :aria-label="group.label">
      <NuxtLink
        v-for="item in group.items"
        :key="item.id"
        :to="item.to"
        :external="item.external"
        class="nasq-module-rail-link"
        :data-active="item.id === props.activeId"
        :aria-current="item.id === props.activeId ? 'page' : undefined"
        :aria-label="t(item.labelKey)"
        :title="t(item.labelKey)"
      >
        <span v-if="item.id === props.activeId" data-slot="indicator" class="nasq-module-rail-indicator" aria-hidden="true" />
        <UIcon :name="item.icon" class="nasq-shell-icon" aria-hidden="true" />
        <!-- Up to two lines instead of an ellipsis: «My to-dos» must stay readable at 64px. -->
        <span data-slot="label" class="line-clamp-2 whitespace-normal! text-balance break-words">{{ t(item.labelKey) }}</span>
      </NuxtLink>
    </nav>
  </aside>
</template>
