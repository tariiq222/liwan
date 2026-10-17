<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { routeTabClass, routeTabPillClass, routeTabsPillStripClass, routeTabsStripClass } from '../../../utils/sectionTabs'

// Route-backed tabs (DESIGN.md §6): links in a strip. The default `underline` variant draws one straight underline
// under the current item (record sections); `pill` is the round pill strip of the project workspace, the current
// item a primary-tinted pill. The caller decides which item is active and names each by `key`, which is also its
// test id.
const props = withDefaults(defineProps<{
  items: { key: string; label: string; to: RouteLocationRaw; active: boolean; icon?: string }[]
  ariaLabel: string
  variant?: 'underline' | 'pill'
}>(), { variant: 'underline' })
</script>

<template>
  <nav v-if="props.items.length" :class="props.variant === 'pill' ? routeTabsPillStripClass : routeTabsStripClass" :aria-label="props.ariaLabel">
    <UButton
      v-for="item in props.items"
      :key="item.key"
      color="neutral"
      variant="ghost"
      :class="props.variant === 'pill' ? routeTabPillClass : routeTabClass"
      :to="item.to"
      :aria-current="item.active ? 'page' : undefined"
      :data-active="item.active"
      :data-testid="item.key"
    >
      <UIcon v-if="item.icon" :name="item.icon" aria-hidden="true" class="size-4" />
      <span>{{ item.label }}</span>
    </UButton>
  </nav>
</template>
