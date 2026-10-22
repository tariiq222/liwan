<script setup lang="ts">
import BrandWordmark from '../shared/layout/BrandWordmark.vue'
import type { ShellRailGroups } from '../../types/shell'

// The module rail: a white floating card, a 20px icon over a 12px label, and the logo mark alone at the bottom.
// Top to bottom: the fixed entries (launcher, today), the pinned applications under a small label (this run scrolls;
// with none pinned it is an empty, hidden filler so the entries below still sit at the bottom),
// the customize entry, then the utility group (assistant, then settings). The active entry has a tinted icon circle
// with an 8px blue dot on its inline-start edge.
const props = defineProps<{
  rail: ShellRailGroups
  activeId: string | null
  homeTo: string
}>()
const { t } = useI18n()
const groups = computed(() => [
  { key: 'top', items: props.rail.top, label: t('nav.railApps'), class: 'webvue-module-rail-top' },
  // Always present: the run takes the free height, so the entries below it stay at the bottom.
  { key: 'pinned', items: props.rail.pinned, label: t('nav.pinned'), class: 'webvue-module-rail-links', divider: true },
  { key: 'customize', items: props.rail.customize ? [props.rail.customize] : [], label: t('nav.customize'), class: 'webvue-module-rail-top' },
  { key: 'utility', items: props.rail.utility, label: t('nav.railTools'), class: 'webvue-module-rail-utility' },
].filter(group => group.items.length || group.key === 'pinned'))

</script>

<template>
  <aside data-testid="module-rail" data-fresh-navigation class="webvue-module-rail" :aria-label="t('nav.modules')">
    <template v-for="group in groups" :key="group.key">
      <div v-if="!group.items.length" :class="group.class" aria-hidden="true" :data-group="group.key" />
      <nav v-else :class="group.class" :aria-label="group.label" :data-group="group.key">
        <!-- A non-interactive divider label over the pinned run. -->
        <span v-if="group.divider" class="webvue-module-rail-divider" data-testid="module-rail-pinned-label" aria-hidden="true">{{ group.label }}</span>
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
    </template>
    <NuxtLink :to="props.homeTo" class="webvue-module-rail-brand" :aria-label="`${t('brand.name')} — ${t('nav.home')}`">
      <BrandWordmark size="md" mark-only />
    </NuxtLink>
  </aside>
</template>
