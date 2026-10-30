<script setup lang="ts">
import type { ShellQuickItem } from '../../types/shell'
import ShellQuickRow from './ShellQuickRow.vue'

// The quick views card under the context sidebar: presets of the current list (views), a hairline, then the page's
// actions (the create action first, with a plus chip). Props only; the app derives the rows from quickViewsModel().
// It folds to the same 64px icon-only bar as the context sidebar, rows keeping a title and a tooltip.
const props = defineProps<{
  label: string
  views: ShellQuickItem[]
  actions: ShellQuickItem[]
  collapsed: boolean
  /** `card` floats under the context sidebar; `drawer` is the flat section of the mobile drawer. */
  surface?: 'card' | 'drawer'
  /** Prefix of the test ids, so the drawer copy and the card never share one. */
  testIdPrefix?: string
  /** Name of the views group, read by assistive technology only. */
  viewsLabel?: string
  actionsLabel?: string
}>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
</script>

<template>
  <aside v-if="props.views.length || props.actions.length" :data-testid="`${props.testIdPrefix ?? ''}quick-views`" class="liwan-quick-views" :data-expanded="!props.collapsed" :data-surface="props.surface ?? 'card'" :aria-label="props.label">
    <nav v-if="props.views.length" class="liwan-quick-group" data-fresh-navigation :aria-label="props.viewsLabel ?? props.label" :data-testid="`${props.testIdPrefix ?? ''}quick-views-list`">
      <ShellQuickRow v-for="item in props.views" :key="item.id" :item="item" :test-id="`${props.testIdPrefix ?? ''}quick-view-${item.id}`" :collapsed="props.collapsed" @navigate="emit('navigate', $event)" />
    </nav>
    <hr v-if="props.views.length && props.actions.length" class="liwan-quick-divider" :data-testid="`${props.testIdPrefix ?? ''}quick-views-divider`">
    <nav v-if="props.actions.length" class="liwan-quick-group" data-fresh-navigation :aria-label="props.actionsLabel ?? props.label" :data-testid="`${props.testIdPrefix ?? ''}quick-actions-list`">
      <ShellQuickRow v-for="item in props.actions" :key="item.id" :item="item" :test-id="`${props.testIdPrefix ?? ''}quick-action-${item.id}`" :collapsed="props.collapsed" action @navigate="emit('navigate', $event)" />
    </nav>
  </aside>
</template>
