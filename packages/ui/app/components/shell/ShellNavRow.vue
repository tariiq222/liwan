<script setup lang="ts">
import type { ShellQuickItem } from '../../types/shell'

// One link row of the sidebar: icon (or the application's tile), label, optional count. Between 768px and 1099px the
// label drops out visually and the `title` keeps the name; the accessible name is always the label.
const props = defineProps<{ item: ShellQuickItem; testId?: string }>()
const emit = defineEmits<{ navigate: [item: ShellQuickItem] }>()
const countLabel = (value: number) => (value > 99 ? '99+' : String(value))
</script>

<template>
  <NuxtLink
    :to="props.item.to"
    class="liwan-side-row"
    :data-active="props.item.active ? 'true' : undefined"
    :data-primary="props.item.primary ? 'true' : undefined"
    :aria-current="props.item.active ? 'page' : undefined"
    :aria-label="props.item.label"
    :title="props.item.label"
    :data-testid="props.testId"
    @click="emit('navigate', props.item)"
  >
    <span data-slot="icon" aria-hidden="true">
      <ShellAppTile v-if="props.item.app" :icon="props.item.icon" :app="props.item.app" />
      <UIcon v-else :name="props.item.icon" class="liwan-shell-icon" />
    </span>
    <span data-slot="label">{{ props.item.label }}</span>
    <span v-if="props.item.count !== undefined" data-slot="count" dir="ltr">{{ countLabel(props.item.count) }}</span>
  </NuxtLink>
</template>
