<script setup lang="ts">
import type { ShellQuickItem } from '../../types/shell'

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
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
</script>

<template>
  <aside v-if="props.views.length || props.actions.length" :data-testid="`${props.testIdPrefix ?? ''}quick-views`" class="webvue-quick-views" :data-expanded="!props.collapsed" :data-surface="props.surface ?? 'card'" :aria-label="props.label">
    <nav v-if="props.views.length" class="webvue-quick-group" data-fresh-navigation :aria-label="props.viewsLabel ?? props.label" :data-testid="`${props.testIdPrefix ?? ''}quick-views-list`">
      <div v-for="item in props.views" :key="item.id" class="webvue-quick-row">
        <UTooltip :text="item.label" :disabled="!props.collapsed">
          <UButton
            :to="item.to"
            color="neutral"
            variant="ghost"
            class="webvue-quick-link"
            :data-active="item.active"
            :active="!!item.active"
            :aria-current="item.active ? 'true' : undefined"
            :aria-label="item.label"
            :data-testid="`${props.testIdPrefix ?? ''}quick-view-${item.id}`"
            @click="emit('navigate', item)"
          >
            <template #leading>
              <span class="webvue-quick-chip" aria-hidden="true"><UIcon :name="item.icon" class="webvue-shell-icon size-4 shrink-0" /></span>
            </template>
            <span data-slot="label">{{ item.label }}</span>
          </UButton>
        </UTooltip>
        <span v-if="item.count !== undefined" class="webvue-quick-count">{{ countLabel(item.count) }}</span>
      </div>
    </nav>
    <hr v-if="props.views.length && props.actions.length" class="webvue-quick-divider" :data-testid="`${props.testIdPrefix ?? ''}quick-views-divider`">
    <nav v-if="props.actions.length" class="webvue-quick-group" data-fresh-navigation :aria-label="props.actionsLabel ?? props.label" :data-testid="`${props.testIdPrefix ?? ''}quick-actions-list`">
      <div v-for="item in props.actions" :key="item.id" class="webvue-quick-row">
        <UTooltip :text="item.label" :disabled="!props.collapsed">
          <UButton
            :to="item.to"
            color="neutral"
            variant="ghost"
            class="webvue-quick-link webvue-quick-action"
            :data-primary="item.primary ? 'true' : undefined"
            :data-active="item.active"
            :active="!!item.active"
            :aria-current="item.active ? 'true' : undefined"
            :aria-label="item.label"
            :data-testid="`${props.testIdPrefix ?? ''}quick-action-${item.id}`"
            @click="emit('navigate', item)"
          >
            <template #leading>
              <span class="webvue-quick-chip" aria-hidden="true"><UIcon :name="item.icon" class="webvue-shell-icon size-4 shrink-0" /></span>
            </template>
            <span data-slot="label">{{ item.label }}</span>
          </UButton>
        </UTooltip>
      </div>
    </nav>
  </aside>
</template>
