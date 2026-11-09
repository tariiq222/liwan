<script setup lang="ts">
import type { ShellQuickItem } from '../../types/shell'

// The icon row under the organisation: one tile per core application, each a link to that application's own page.
// The row has no labels at any width, so every tile carries the name as its accessible name and always shows the name
// tooltip. Between 768px and 1099px the row stands upright at the top of the icon strip. Presentational: the items,
// their open flag and their counts come in as props.
const props = defineProps<{
  /** Accessible name of the group. */
  label: string
  items: ShellQuickItem[]
  /** Prefix of every tile's test id, so the drawer copy and the column never share one. */
  testIdPrefix?: string
}>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
const nameOf = (item: ShellQuickItem) => (item.count === undefined ? item.label : `${item.label} (${countLabel(item.count)})`)
</script>

<template>
  <div v-if="props.items.length" class="liwan-side-core" role="group" :aria-label="props.label" :data-testid="`${props.testIdPrefix ?? ''}core-apps`">
    <ShellTip v-for="item in props.items" :key="item.id" :label="item.label" always>
      <NuxtLink
        :to="item.to"
        class="liwan-core-app"
        :data-active="item.active ? 'true' : undefined"
        :aria-current="item.active ? 'page' : undefined"
        :aria-label="nameOf(item)"
        :data-testid="`${props.testIdPrefix ?? ''}core-app-${item.id}`"
        @click="emit('navigate', item)"
      >
        <UIcon :name="item.icon" aria-hidden="true" />
        <span v-if="item.count !== undefined" data-slot="badge" dir="ltr" aria-hidden="true">{{ countLabel(item.count) }}</span>
      </NuxtLink>
    </ShellTip>
  </div>
</template>
