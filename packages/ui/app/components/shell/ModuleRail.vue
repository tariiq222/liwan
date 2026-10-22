<script setup lang="ts">
import BrandWordmark from '../shared/layout/BrandWordmark.vue'
import type { ShellRailItem } from '../../types/shell'

// The module rail: a white floating card, a 20px icon over a 12px label, and the logo mark alone at the bottom,
// under the utility group (assistant, then settings). The active module has a tinted icon circle with an 8px blue dot on its inline-start edge.
const props = defineProps<{
  modules: ShellRailItem[]
  utility: ShellRailItem[]
  activeId: string | null
  homeTo: string
}>()
const { t } = useI18n()
const groups = computed(() => [
  { key: 'modules', items: props.modules, label: t('nav.railApps'), class: 'webvue-module-rail-links' },
  { key: 'utility', items: props.utility, label: t('nav.railTools'), class: 'webvue-module-rail-utility' },
].filter(group => group.items.length))
</script>

<template>
  <aside data-testid="module-rail" data-fresh-navigation class="webvue-module-rail" :aria-label="t('nav.modules')">
    <nav v-for="group in groups" :key="group.key" :class="group.class" :aria-label="group.label">
      <NuxtLink
        v-for="item in group.items"
        :key="item.id"
        :to="item.to"
        class="webvue-module-rail-link"
        :data-active="item.id === props.activeId"
        :aria-current="item.id === props.activeId ? 'page' : undefined"
        :aria-label="t(item.labelKey)"
        :title="t(item.labelKey)"
      >
        <span data-slot="icon" class="webvue-module-rail-icon" aria-hidden="true">
          <UIcon :name="item.icon" class="webvue-shell-icon" />
        </span>
        <!-- One line under the icon: an entry whose full name is long carries a short one; the full name stays the tooltip. -->
        <span data-slot="label">{{ t(item.shortLabelKey ?? item.labelKey) }}</span>
      </NuxtLink>
    </nav>
    <NuxtLink :to="props.homeTo" class="webvue-module-rail-brand" :aria-label="`${t('brand.name')} — ${t('nav.home')}`">
      <BrandWordmark size="md" mark-only />
    </NuxtLink>
  </aside>
</template>
