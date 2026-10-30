<script setup lang="ts">
import { ref } from 'vue'
import BrandWordmark from '../shared/layout/BrandWordmark.vue'
import { useScrollEdges } from '../../composables/useScrollEdges'
import type { ShellRailGroups } from '../../types/shell'

const props = defineProps<{ rail: ShellRailGroups; activeId: string | null; homeTo: string }>()
const { t } = useI18n()
const scroller = ref<HTMLElement | null>(null)
const content = ref<HTMLElement | null>(null)
const edges = useScrollEdges(scroller, content)
const groups = computed(() => [
  { key: 'top', items: props.rail.top, label: t('nav.railApps'), class: 'liwan-module-rail-top' },
  { key: 'applications', items: props.rail.applications, label: t('nav.railApps'), class: 'liwan-module-rail-links' },
  { key: 'utility', items: props.rail.utility, label: t('nav.railTools'), class: 'liwan-module-rail-utility' },
].filter(group => group.items.length || group.key === 'applications'))
function capture(group: string, target: 'container' | 'content', element: unknown) {
  if (group !== 'applications') return
  const destination = target === 'container' ? scroller : content
  destination.value = element as HTMLElement | null
}
</script>

<template>
  <aside data-testid="module-rail" data-fresh-navigation class="liwan-module-rail" :aria-label="t('nav.modules')">
    <div v-for="group in groups" :key="group.key" :class="group.key === 'applications' ? 'liwan-module-rail-scroll' : 'liwan-module-rail-group'">
      <nav
        :ref="element => capture(group.key, 'container', element)"
        :class="group.class"
        :aria-label="group.label"
        :aria-hidden="!group.items.length || undefined"
        :data-group="group.key"
        @scroll.passive="edges.measure"
      >
        <div :ref="element => capture(group.key, 'content', element)" class="liwan-module-rail-content">
          <NuxtLink
            v-for="item in group.items"
            :key="item.id"
            :to="item.to"
            class="liwan-module-rail-link"
            :data-active="item.id === props.activeId"
            :aria-current="item.id === props.activeId ? 'page' : undefined"
            :title="t(item.labelKey)"
          >
            <span data-slot="icon" class="liwan-module-rail-icon" aria-hidden="true"><UIcon :name="item.icon" class="liwan-shell-icon" /></span>
            <span data-slot="label">{{ t(item.shortLabelKey ?? item.labelKey) }}</span>
          </NuxtLink>
        </div>
      </nav>
      <template v-if="group.key === 'applications'">
        <span v-if="edges.top.value" class="liwan-module-rail-fade liwan-module-rail-fade-top" data-testid="rail-fade-top" aria-hidden="true" />
        <span v-if="edges.bottom.value" class="liwan-module-rail-fade liwan-module-rail-fade-bottom" data-testid="rail-fade-bottom" aria-hidden="true" />
      </template>
    </div>
    <NuxtLink :to="props.homeTo" class="liwan-module-rail-brand" :aria-label="`${t('brand.name')} — ${t('nav.home')}`"><BrandWordmark size="md" mark-only /></NuxtLink>
  </aside>
</template>
